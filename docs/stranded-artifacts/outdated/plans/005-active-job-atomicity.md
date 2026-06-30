# Plan 005: Enforce one active job per repo at the database level and make terminal transitions race-safe

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- src/db/schema.ts src/routes/repos.ts src/services/scheduler.ts src/services/job-lifecycle.ts test/ drizzle/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (schema migration + behavior change under concurrency)
- **Depends on**: plans/002-lifecycle-test-backfill.md, plans/004-rescue-stuck-queued-jobs.md (it changes `markFailedByDeadline`; land it first to avoid conflicts)
- **Category**: bug
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

The "one active job per repo" rule is enforced only by a check-then-act SELECT in the manual-trigger endpoint — two concurrent trigger requests can both pass the check and both insert. The scheduler doesn't check at all: if a backup runs longer than the repo's interval, the cron tick enqueues a second concurrent job for the same repo. Separately, the job state machine hardened `markRunning` with an atomic conditional UPDATE (closing a duplicate-queue-message race — see `review/ARCHITECTURE_DEEPENING.md`), but the other four transitions (`markCompleted`, `recordFailure`, `markFailedByDeadline`, `cancel`) still use SELECT-then-UPDATE, so concurrent duplicate callbacks can double-insert `runs` rows and double-fire side effects. This plan moves the invariant into SQLite (partial unique index) and applies the existing conditional-UPDATE pattern to all transitions.

## Current state

- `src/db/schema.ts:21-48` — `jobs` table (drizzle, SQLite/D1). `status` enum: `queued | running | completed | failed`. No index on active status. The `repos` table shows the existing index convention:

```ts
// src/db/schema.ts:18
(t) => ({ uniqOwnerName: unique().on(t.owner, t.name) })
```

- `src/routes/repos.ts:286-298` — the check (SELECT active job → 409) followed at lines 325–343 by an unconditional INSERT + queue send. Keep the friendly pre-check; add constraint-violation handling as the real guard.
- `src/services/scheduler.ts:62-82` — inserts a job + sends queue message for every due repo with **no active-job check at all**.
- `src/services/job-lifecycle.ts` — `markRunning` (lines 33–81) is the exemplar pattern to replicate: conditional UPDATE with all preconditions in the WHERE clause, `.returning({...})`, then a diagnostic SELECT only when 0 rows matched:

```ts
// src/services/job-lifecycle.ts:44-59 (the pattern to copy)
const updated = await db
  .update(schema.jobs)
  .set({ status: "running", deadline_at: computeDeadline(), updated_at: timestamp })
  .where(
    and(
      eq(schema.jobs.id, jobId),
      eq(schema.jobs.status, "queued"),
      eq(schema.jobs.idempotency_key, expectedIdempotencyKey),
      eq(schema.jobs.attempt, expectedAttempt)
    )
  )
  .returning({ id: schema.jobs.id });
```

  - `markCompleted` (94–140): SELECT job → status check → UPDATE → INSERT runs row. Returns `{ok:true, runId, repoId, startedAt, finishedAt}`.
  - `recordFailure` (158–237): SELECT job → branch on `job.attempt < MAX_ATTEMPTS` → UPDATE (requeue or fail) → maybe INSERT runs row.
  - `markFailedByDeadline` (244–285): after plan 004, accepts `queued|running`.
  - `cancel` (293–334): accepts `queued|running`.
- Migrations: drizzle-kit. `bun run db:generate` creates a numbered SQL file in `drizzle/` (existing: `0000_groovy_stranger.sql` … `0003_change_detection.sql`); `bun run db:migrate:local` applies locally. **Tests do NOT use these files** — `test/helpers/migrations.ts` contains an inline schema that must be updated by hand to match.
- Tests use `@cloudflare/vitest-pool-workers`; D1 errors for constraint violations surface as thrown `Error`s whose message contains `UNIQUE constraint failed`.

## Commands you will need

| Purpose         | Command                      | Expected on success                       |
|-----------------|------------------------------|-------------------------------------------|
| Install         | `bun install`                | exit 0                                    |
| Gen migration   | `bun run db:generate`        | new `drizzle/000N_*.sql` file created     |
| Apply local     | `bun run db:migrate:local`   | exit 0                                    |
| Typecheck       | `bun run typecheck`          | exit 0                                    |
| Tests           | `bun run test`               | all pass                                  |
| Lint            | `bun run check`              | exit 0                                    |

## Scope

**In scope** (the only files you should modify/create):
- `src/db/schema.ts`
- `drizzle/` (generated migration — generated, not hand-written)
- `test/helpers/migrations.ts` (mirror the new index)
- `src/routes/repos.ts` (trigger endpoint only, lines ~272–351)
- `src/services/scheduler.ts` (due-repo loop only)
- `src/services/job-lifecycle.ts`
- `test/api.test.ts`, `test/scheduler.test.ts` (add tests)

**Out of scope** (do NOT touch):
- `src/routes/callback.ts`, `src/queue/consumer.ts` — they consume the lifecycle results; the result types must not change shape.
- `drizzle/0000–0003_*.sql` — never edit applied migrations.
- The 5-minute cooldown logic in the trigger endpoint (plan 006 touches its query).
- Remote/production migration (`wrangler d1 migrations apply gitcask-db --remote`) — that is an operator action; note it in your completion report.

## Git workflow

- Branch: `fix/005-active-job-atomicity`
- Commit style: conventional commits; suggest two commits: `feat: enforce single active job per repo via partial unique index` and `refactor: make terminal job transitions conditional updates`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the partial unique index

In `src/db/schema.ts`, import `uniqueIndex` from `drizzle-orm/sqlite-core` and `sql` from `drizzle-orm`, and add a config callback to the `jobs` table (third argument, same style as `repos`):

```ts
(t) => ({
  activeRepoJob: uniqueIndex("jobs_active_repo_idx")
    .on(t.repo_id)
    .where(sql`status IN ('queued', 'running')`),
})
```

Run `bun run db:generate`. Inspect the generated SQL — it must read:

```sql
CREATE UNIQUE INDEX `jobs_active_repo_idx` ON `jobs` (`repo_id`) WHERE status IN ('queued', 'running');
```

Mirror it in `test/helpers/migrations.ts` by appending to the inline `migration` string (it is split on `;`, so add it as another statement):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_repo_idx ON jobs (repo_id) WHERE status IN ('queued', 'running');
```

**Verify**: `bun run db:migrate:local` → exit 0. `bun run test` → existing tests still pass (none insert two active jobs for one repo today).

### Step 2: Handle the constraint in the trigger endpoint

In `src/routes/repos.ts` trigger handler, wrap the `db.insert(schema.jobs)...` call (lines ~325–335) in try/catch. On an error whose `message` includes `"UNIQUE constraint failed"`, return the same response as the pre-check: `c.json({ error: "A job is already queued or running" }, 409)`. Re-throw anything else. The queue send stays AFTER the insert and is skipped when the insert fails (early return). Keep the existing pre-check SELECT — it gives the common case a clean 409 without an exception.

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Handle the constraint in the scheduler

In `src/services/scheduler.ts`, wrap the job INSERT (lines ~62–72) in try/catch. On `"UNIQUE constraint failed"`: log (`console.log("[scheduler] skipped repo — job already active", { repo: ... })`), still advance `next_run_at` (same UPDATE as the success path, lines 89–92 — a backup is already in flight, so the next interval starts now), and `continue` WITHOUT sending a queue message. Re-throw anything else.

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Conditional UPDATEs for the four remaining transitions

In `src/services/job-lifecycle.ts`, rework each function to the `markRunning` pattern. **Result types must not change.**

- `markCompleted`: SELECT the job first (you need `repo_id` and `created_at` for the runs insert and return value — keep this read), then make the UPDATE conditional on `and(eq(id), eq(status, "running"))` with `.returning({ id })`. If 0 rows returned, re-SELECT and return the existing `not-found` / `not-running` diagnosis. Only insert the `runs` row when the conditional UPDATE matched.
- `recordFailure`: keep the initial SELECT (needed for the `attempt` branch). Make both UPDATEs conditional on `and(eq(id), eq(status, "running"), eq(attempt, job.attempt))` with `.returning({ id })`. On 0 rows, re-diagnose (`not-found` / `not-running`). Only insert the failure `runs` row when the terminal UPDATE matched.
- `markFailedByDeadline` and `cancel`: same treatment; their WHERE includes the two sweepable statuses. Use `inArray(schema.jobs.status, ["queued", "running"])` (import `inArray` from drizzle-orm). For `cancel`, preserve the distinct `already-completed`/`already-failed` reasons in the 0-row diagnosis.

The residual SELECT-before-UPDATE is fine: correctness now comes from the WHERE clause, the SELECT is only for data and diagnostics.

**Verify**: `bun run test` → all existing tests pass, including plan-002's cancel/sweep tests and the existing callback tests in `test/api.test.ts` (success, failure+retry).

### Step 5: Add tests

In `test/api.test.ts`:
1. **index enforces single active job** — insert repo + job (`status='queued'`) via `env.DB.prepare`; attempt a second raw INSERT for the same repo with `status='running'`; assert it rejects with `/UNIQUE constraint failed/`. Then insert one with `status='completed'` for the same repo; assert it succeeds (the index is partial).
2. **duplicate completion callback is idempotent** — drive a job to `running` (raw insert), POST `/internal/jobs/:id/complete` with a success payload twice; first → 200, second → 409; assert exactly one `runs` row exists.

In `test/scheduler.test.ts`:
3. **scheduler skips repo with an active job and advances next_run_at** — repo due now (`next_run_at` in the past), `last_backup_at`/`last_pushed_at` set so change-detection says run (mock `fetch` with a NEW `pushed_at`), plus an existing `queued` job for the repo; run `handleScheduledEvent`; assert `send` not called for a second message (0 calls), job count for repo still 1, and `next_run_at` advanced past the old value.

**Verify**: `bunx vitest run test/api.test.ts test/scheduler.test.ts` → all pass including 3 new.

### Step 6: Full gate

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0.

## Test plan

See Step 5. Patterns: raw-insert + route style from `test/api.test.ts`; scheduler style from `test/scheduler.test.ts`. The plan-002 characterization tests are the regression net for Step 4.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "jobs_active_repo_idx" src/db/schema.ts test/helpers/migrations.ts drizzle/*.sql` → a match in each
- [ ] `grep -c "returning" src/services/job-lifecycle.ts` ≥ 5 (markRunning + the four reworked transitions)
- [ ] `bun run test` exits 0 with 3 new tests
- [ ] `bun run typecheck` and `bun run check` exit 0
- [ ] No modified files outside the in-scope list (`git status`)
- [ ] `plans/README.md` status row updated, with a note that the operator must run the remote migration before the next deploy

## STOP conditions

Stop and report back (do not improvise) if:

- `bun run db:generate` produces SQL that does NOT include the `WHERE status IN (...)` clause (drizzle version may not support partial indexes — do not hand-edit the generated file into something drizzle's snapshot doesn't know about; report instead).
- Plans 002/004 are not yet landed (their tests/changes are assumed present).
- Any existing callback/retry test fails after Step 4 in a way that suggests the result types changed shape — the consumers (`callback.ts`, `consumer.ts`) must compile untouched.
- You need to modify `src/routes/callback.ts` or `src/queue/consumer.ts` for any reason.

## Maintenance notes

- **Operator action before next production deploy**: `bunx wrangler d1 migrations apply gitcask-db --remote`. If production data already contains two active jobs for one repo, the index creation will fail — cancel duplicates first (`POST /jobs/:id/cancel`), or wait for the plan-004 sweep to clear them.
- Residual (accepted) gap: a transition's UPDATE and its `runs` INSERT are still two statements; a Worker crash between them leaves a terminal job with no run row. Closing it needs D1 batch with conditional semantics — deliberately not done; revisit only if observed.
- The scheduler's "advance next_run_at on conflict" choice means a repo whose backup outlasts its interval gets its next backup one full interval after the conflict tick, not immediately after the running job finishes. If that proves wrong, the alternative (don't advance; retry in 5 min) is a one-line change in Step 3.
