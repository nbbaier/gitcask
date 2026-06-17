# Plan 002: Backfill tests for the deadline sweep and the job-cancel endpoint

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- test/ src/services/job-lifecycle.ts src/services/scheduler.ts src/routes/jobs.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md
- **Category**: tests
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

Two failure-recovery paths in the job state machine have **zero test coverage**, and both were explicitly flagged as follow-ups in `review/ARCHITECTURE_DEEPENING.md` (lines 44–51): (a) the scheduler's deadline sweep that fails stuck `running` jobs, and (b) `POST /jobs/:id/cancel`. Plans 004 and 005 modify exactly this code (`job-lifecycle.ts`, `scheduler.ts`), so these characterization tests must land first — they are the safety net for those changes.

## Current state

This is a Cloudflare Workers app tested with `@cloudflare/vitest-pool-workers` (Miniflare emulation, no real services). The test runner is vitest, invoked via `bun run test`.

- `src/services/job-lifecycle.ts` — the job state machine. Two functions under test here:
  - `markFailedByDeadline(db, jobId)` (lines 244–285): loads the job, returns `{ok:false, reason:"not-running"}` unless `status === "running"`, otherwise sets `status="failed"`, clears `stage`/`stage_updated_at`/`deadline_at`, and inserts a `runs` row with `error: "Job exceeded deadline without callback"`.
  - `cancel(db, jobId)` (lines 293–334): returns `not-found` / `already-completed` / `already-failed`, otherwise (for `queued` OR `running`) sets `status="failed"`, clears the same fields, and inserts a `runs` row with `error: "Manually cancelled"`.
- `src/services/scheduler.ts` — `handleScheduledEvent(env)`. After processing due repos, the deadline sweep (lines 95–123):

```ts
// src/services/scheduler.ts:95-116
const staleJobs = await db
  .select()
  .from(schema.jobs)
  .where(
    and(
      eq(schema.jobs.status, "running"),
      lte(schema.jobs.deadline_at, timestamp)
    )
  );
// ...
for (const job of staleJobs) {
  // ...
  const result = await markFailedByDeadline(db, job.id);
```

- `src/routes/jobs.ts` — `POST /jobs/:id/cancel` (lines 62–80): calls `lifecycle.cancel`; 404 on `not-found`; 409 with `{ error: "Job is already completed" }` / `"Job is already failed"` otherwise; 200 with `{ status: "cancelled", job_id }` on success. Mounted under adminAuth at `/jobs` (see `src/index.ts:504-510`).
- `test/scheduler.test.ts` — exemplar for scheduler tests: `beforeEach` applies migrations via `applyMigrations(env.DB)` (from `test/helpers/migrations.ts`) and deletes from `runs`, `jobs`, `repos`; uses `vi.useFakeTimers()` + `vi.setSystemTime(...)`, mocks `globalThis.fetch` for the GitHub call, stubs the queue with `const send = vi.fn()` and calls `handleScheduledEvent({ ...env, JOB_QUEUE: { send } as never })`. **Model the new sweep tests after this file.**
- `test/api.test.ts` — exemplar for route tests: a `makeRequest(path, options, token="test-admin-token")` helper builds authed requests; each test does `createExecutionContext()` → `worker.fetch(req, env, ctx)` → `waitOnExecutionContext(ctx)`; DB state is asserted with raw `env.DB.prepare(...).bind(...).first/run()`. The `beforeEach` also clears the `artifacts` table. **Model the cancel tests after this file.**
- Jobs table columns (see `src/db/schema.ts:21-48`): `id, repo_id, trigger_source ('schedule'|'manual'), idempotency_key, status ('queued'|'running'|'completed'|'failed'), stage, stage_updated_at, attempt (default 1), deadline_at, created_at, updated_at`. Repos insert pattern (all NOT NULL columns) is shown in both test files.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `bun install`                        | exit 0              |
| Typecheck | `bun run typecheck`                  | exit 0              |
| Tests     | `bun run test`                       | all pass            |
| One file  | `bunx vitest run test/scheduler.test.ts` | file passes    |
| Lint      | `bun run check`                      | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `test/scheduler.test.ts` (add a `describe` block)
- `test/api.test.ts` (add a `describe` block)

**Out of scope** (do NOT touch):
- `src/**` — this plan is test-only. If a test you write fails because of an apparent bug in `src/`, that is a STOP condition (report it; plans 004/005 change this code deliberately).
- `test/helpers/migrations.ts` — the inline schema there already includes everything needed.

## Git workflow

- Branch: `test/002-lifecycle-backfill`
- Commit style: conventional commits, e.g. `test: backfill deadline sweep and cancel coverage`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Deadline sweep test (scheduler.test.ts)

Add a new top-level `describe("handleScheduledEvent deadline sweep", ...)` block reusing the existing `beforeEach`/`afterEach` pattern (copy it into the new describe — the existing hooks are scoped to the change-detection describe). Test case: **"fails a running job past its deadline and records a run"**:

1. Fake timers, `vi.setSystemTime(new Date("2026-03-02T12:00:00.000Z"))`.
2. Insert a repo with `next_run_at` in the FUTURE (e.g. `"2026-03-03T00:00:00.000Z"`) so the due-repo loop does nothing and no GitHub fetch happens (still mock `globalThis.fetch` defensively to a resolved `Response`).
3. Insert a job for that repo: `status='running'`, `attempt=1`, `deadline_at='2026-03-02T11:00:00.000Z'` (one hour in the past), `stage='cloning'`, `stage_updated_at` set.
4. Call `handleScheduledEvent({ ...env, JOB_QUEUE: { send: vi.fn() } as never })`.
5. Assert: job row now has `status='failed'`, `stage IS NULL`, `deadline_at IS NULL`; exactly one `runs` row exists for the repo with `status='failed'` and `error='Job exceeded deadline without callback'`.

Add a second case: **"leaves running jobs within deadline untouched"** — same setup but `deadline_at` one hour in the future; assert job still `running` and zero runs rows.

**Verify**: `bunx vitest run test/scheduler.test.ts` → all tests in file pass (2 existing + 2 new).

### Step 2: Cancel endpoint tests (api.test.ts)

Add `describe("POST /jobs/:id/cancel", ...)` inside the top-level `describe("Gitcask API", ...)` block (so it shares the existing `beforeEach`). Four cases:

1. **cancels a queued job** → insert repo + job with `status='queued'`; `makeRequest(`/jobs/${jobId}/cancel`, { method: "POST" })`; expect 200, body `{ status: "cancelled", job_id: jobId }`; assert DB: job `status='failed'`, `deadline_at IS NULL`; one runs row with `error='Manually cancelled'`, `status='failed'`.
2. **cancels a running job** → same with `status='running'` and a non-null `stage`; additionally assert `stage IS NULL` after.
3. **409 on completed job** → job `status='completed'`; expect 409, body error `"Job is already completed"`; assert no runs row was created.
4. **404 on unknown job** → random UUID; expect 404.

**Verify**: `bunx vitest run test/api.test.ts` → all tests pass (existing + 4 new).

### Step 3: Full gate

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0; total test count is at least 30 (24 existing + 6 new).

## Test plan

This plan IS the test plan — see Steps 1–2 for the case list. Structural patterns: `test/scheduler.test.ts` for the sweep, `test/api.test.ts` for the route.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run test` exits 0 with ≥30 tests passing
- [ ] `grep -c "deadline" test/scheduler.test.ts` ≥ 2
- [ ] `grep -c "cancel" test/api.test.ts` ≥ 4
- [ ] `bun run typecheck` and `bun run check` exit 0
- [ ] `git status` shows only `test/scheduler.test.ts` and `test/api.test.ts` modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- A new test fails in a way that implicates `src/` behavior (e.g. the sweep does NOT fail a past-deadline running job, or cancel returns the wrong status code). The source is the spec here — report the discrepancy.
- The existing 24 tests don't pass before you start.
- `test/api.test.ts` no longer contains the `makeRequest` helper or the `describe("Gitcask API")` wrapper described above.

## Maintenance notes

- Plan 004 will EXTEND the sweep to also fail stuck `queued` jobs — it adds its own test cases next to the ones from Step 1 and must not weaken them.
- Plan 005 makes `cancel`/`markCompleted`/`recordFailure` use conditional UPDATEs — the Step 2 assertions (cleared fields, runs rows) must keep passing unchanged.
