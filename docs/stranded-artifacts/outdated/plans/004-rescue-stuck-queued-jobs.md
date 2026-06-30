# Plan 004: Extend the deadline sweep to rescue stuck `queued` jobs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- src/services/scheduler.ts src/services/job-lifecycle.ts test/scheduler.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/002-lifecycle-test-backfill.md (characterization tests for the sweep must exist first)
- **Category**: bug
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

A job can get permanently stuck in `queued` with no recovery path. The retry flow writes `status='queued'` to D1 **and then** sends a new queue message as a separate step (`src/routes/callback.ts:195-215`, `src/queue/consumer.ts:63-83`). If that `JOB_QUEUE.send` throws, or the Worker dies between the two steps, or the queue message is lost, the job sits in `queued` forever: the deadline sweep only selects `status = 'running'`. Worse, the manual-trigger endpoint refuses to create new jobs while any `queued`/`running` job exists for the repo (`src/routes/repos.ts:286-298`), so a single stuck job **permanently blocks manual backups for that repo** until someone finds and cancels it by job ID. The fix: queued jobs already carry a `deadline_at` (set at creation and refreshed on retry) — sweep them too.

## Current state

- `src/services/scheduler.ts:95-123` — the sweep:

```ts
// src/services/scheduler.ts:95-103
const staleJobs = await db
  .select()
  .from(schema.jobs)
  .where(
    and(
      eq(schema.jobs.status, "running"),
      lte(schema.jobs.deadline_at, timestamp)
    )
  );
```

then for each stale job calls `markFailedByDeadline(db, job.id)`.

- `src/services/job-lifecycle.ts:244-285` — `markFailedByDeadline` re-loads the job and **rejects anything not `running`**:

```ts
// src/services/job-lifecycle.ts:253-258
if (!job) {
  return { ok: false, reason: "not-found" };
}
if (job.status !== "running") {
  return { ok: false, reason: "not-running" };
}
```

then sets `status='failed'`, clears `stage`/`stage_updated_at`/`deadline_at`, and inserts a `runs` row with `error: "Job exceeded deadline without callback"`.

- `deadline_at` is ALWAYS set while a job is queued or running:
  - manual trigger: `src/routes/repos.ts:332` sets `deadline_at = now + 15min` on insert;
  - scheduler: `src/services/scheduler.ts:69` same;
  - retry requeue: `src/services/job-lifecycle.ts:187` (`recordFailure`) sets a fresh `computeDeadline()` when flipping back to `queued`;
  - `markRunning` refreshes it (`job-lifecycle.ts:48`).
  Retry queue delays are at most 8 seconds (`retryBackoffMs = 2 ** attempt * 1000`, attempts ≤ 4), so a healthy queued job is consumed long before a 15-minute deadline; sweeping queued-past-deadline cannot race a legitimate delivery. (Caveat: a >15-minute queue outage would fail queued jobs rather than run them late — acceptable: a failed run with a clear error beats a silent permanent block.)
- `drizzle-orm` operators in use: `and`, `eq`, `lte` are already imported in scheduler.ts; you will need `or` added to that import.
- Tests: after plan 002, `test/scheduler.test.ts` has a `describe("handleScheduledEvent deadline sweep")` block with running-job cases. Follow its structure (fake timers, direct `env.DB.prepare(...)` inserts, `handleScheduledEvent({ ...env, JOB_QUEUE: { send } as never })`).

## Commands you will need

| Purpose   | Command                                  | Expected on success |
|-----------|------------------------------------------|---------------------|
| Install   | `bun install`                            | exit 0              |
| Typecheck | `bun run typecheck`                      | exit 0              |
| Tests     | `bun run test`                           | all pass            |
| One file  | `bunx vitest run test/scheduler.test.ts` | file passes         |
| Lint      | `bun run check`                          | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `src/services/scheduler.ts`
- `src/services/job-lifecycle.ts`
- `test/scheduler.test.ts`

**Out of scope** (do NOT touch):
- `src/routes/callback.ts` / `src/queue/consumer.ts` — making the status-write + queue-send atomic is NOT attempted here (the sweep is the chosen safety net; an outbox pattern would be over-engineering at this scale).
- `src/routes/repos.ts` — the active-job guard is plan 005's territory.

## Git workflow

- Branch: `fix/004-stuck-queued-sweep`
- Commit style: conventional commits, e.g. `fix: sweep stuck queued jobs past their deadline`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Widen the sweep query

In `src/services/scheduler.ts`, add `or` to the drizzle-orm import and change the stale-jobs filter to include queued jobs:

```ts
or(
  eq(schema.jobs.status, "running"),
  eq(schema.jobs.status, "queued")
),
lte(schema.jobs.deadline_at, timestamp)
```

(both inside the existing `and(...)`).

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Let `markFailedByDeadline` accept queued jobs

In `src/services/job-lifecycle.ts`, change the guard in `markFailedByDeadline` from `job.status !== "running"` to rejecting only terminal/impossible states:

```ts
if (job.status !== "running" && job.status !== "queued") {
  return { ok: false, reason: "not-running" };
}
```

Keep the `WrongStatus<"not-running">` reason string as-is (renaming it would ripple into the result type; the reason means "not in a sweepable state"). Use a distinct run error message for the queued case so operators can tell the failure modes apart:

```ts
error: job.status === "queued"
  ? "Job stuck in queue past deadline (queue message lost or send failed)"
  : "Job exceeded deadline without callback",
```

Note: the status check captured at the top of the function (the loaded `job`) is what you branch on — capture `job.status` before the UPDATE runs.

**Verify**: `bun run typecheck` → exit 0; `bunx vitest run test/scheduler.test.ts` → the plan-002 running-job sweep tests still pass.

### Step 3: Add queued-job sweep tests

In `test/scheduler.test.ts`, inside the deadline-sweep describe block from plan 002, add:

1. **"fails a queued job stuck past its deadline"** — insert repo (`next_run_at` in the future) + job with `status='queued'`, `deadline_at` 1 hour in the past; run `handleScheduledEvent`; assert job `status='failed'`, `deadline_at IS NULL`, and one `runs` row with `error` = the new queued-case message.
2. **"leaves fresh queued jobs alone"** — `status='queued'`, `deadline_at` 1 hour in the future; assert still `queued`, zero runs rows.

**Verify**: `bunx vitest run test/scheduler.test.ts` → all pass (plan-002 cases + 2 new).

### Step 4: Full gate

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0.

## Test plan

See Step 3. Pattern: the plan-002 deadline-sweep tests in `test/scheduler.test.ts`. Edge cases covered: stuck-queued (swept), fresh-queued (untouched), stuck-running (already covered by plan 002, must keep passing).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n '"queued"' src/services/scheduler.ts` shows the sweep includes queued status
- [ ] `grep -n 'stuck in queue' src/services/job-lifecycle.ts` returns a match
- [ ] `bun run test` exits 0 with 2 new tests beyond the plan-002 count
- [ ] `bun run typecheck` and `bun run check` exit 0
- [ ] `git status` shows only the three in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 002's sweep tests don't exist yet (dependency not landed) — this plan must not proceed without them.
- The retry backoff in `job-lifecycle.ts` is no longer ≤ 8s max (`retryBackoffMs`), or queue `delaySeconds` anywhere exceeds ~60s — the "queued past 15-minute deadline = stuck" assumption would be false and the sweep could kill legitimately delayed jobs.
- `deadline_at` is nullable-in-practice for queued jobs (you find a code path inserting a queued job with NULL `deadline_at`) — the sweep's `lte` filter would silently skip those; report it.

## Maintenance notes

- If anyone introduces long queue delays (e.g. scheduled backfills with `delaySeconds` in minutes), the 15-minute `DEADLINE_MS` in `job-lifecycle.ts:10` must grow accordingly or stuck-queued sweeping will misfire.
- Plan 005 adds a partial unique index on active jobs; a swept (failed) job correctly frees the repo's active slot — these changes compose.
- Reviewer focus: the guard change in Step 2 — confirm `completed`/`failed` jobs still return `not-running` and are never re-failed (no duplicate runs rows).
