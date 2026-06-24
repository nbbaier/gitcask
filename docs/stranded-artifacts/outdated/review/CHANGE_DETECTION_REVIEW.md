# Thermo-Nuclear Code Quality Review — Change Detection

**Date:** May 24, 2026
**Scope:** Uncommitted change-detection work on `main`
**Verdict:** REQUEST CHANGES

The pure decision logic in `evaluateBackupNeed` is well-shaped — small, typed, and well-tested. The problems are in persistence and GitHub I/O around it. Three presumptive blockers before merge.

## Changed Files

**Modified**

- `drizzle/meta/_journal.json`
- `src/db/schema.ts`
- `src/routes/callback.ts`
- `src/routes/repos.ts`
- `src/services/scheduler.ts`
- `test/api.test.ts`

**New**

- `drizzle/0003_change_detection.sql`
- `src/lib/github.ts`
- `src/services/change-detection.ts`
- `test/change-detection.test.ts`
- `test/scheduler.test.ts`

## What Works

- `evaluateBackupNeed` is clean, pure, and well-tested.
- Schema migration is minimal.
- Scheduler integration tests cover skip vs enqueue paths.
- All touched files are well under the 1k-line threshold.

---

## 1. Structural Regressions

### Blocker: `recordSkippedBackup` invents a fake job lifecycle

In `src/services/scheduler.ts`, skipped backups create a job with status `"completed"` (never queued or running) and a run with status `"skipped"`. Every consumer of `jobs` / `runs` now has to special-case scheduler skips.

**Code-judo move (preferred):** don't create jobs or runs on skip. A skip is not a backup — it is "we checked, nothing to do, advance the schedule." That is one `UPDATE repos SET next_run_at = …`. Delete `recordSkippedBackup` and the `"skipped"` run enum unless there is a product requirement for skip audit history (none visible in this diff).

If skip history is required, add `job.status: "skipped"` and stop overloading `"completed"`. Do not keep the current hybrid.

### Blocker: non-atomic skip path can wedge the scheduler

Three sequential writes with no transaction/batch. If the run insert succeeds but `next_run_at` update fails, the repo stays due forever and hammers GitHub every cron tick.

Same class of problem exists elsewhere in the codebase (callback success path is also multi-write), but this change introduces a **new** brittle path on the hot cron loop. Wrap skip handling in D1 batch or restructure to a single-repo update when you drop the fake job.

### `last_run` will surface `"skipped"` as the latest activity

`latestRunByRepo` in `src/routes/repos.ts` picks max `started_at` with no status filter. After a skip tick, `GET /repos` returns `last_run.status: "skipped"`. That reads like a failed or incomplete backup, not "no work needed."

Either exclude skipped runs from `last_run`, or don't persist skips at all (the judo move above).

---

## 2. Missed Code-Judo: Redundant GitHub Fetch for `pushed_at`

`GET /repos/{owner}/{name}` is now fetched in four places:

| Location                                  | Purpose                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `src/lib/github.ts`                       | change detection                                |
| `src/routes/callback.ts`                  | update `last_pushed_at` after backup            |
| `src/routes/repos.ts` POST                | validate repo exists (inline, not using helper) |
| `container/server.ts` `fetching_metadata` | metadata.json (already has full GH response)    |

The container already hits GitHub at `fetching_metadata` and parses the response — it just doesn't send `pushed_at` back. `ghData` has `pushed_at` but it is discarded when building metadata.

**Reframe:** extend `ContainerCallbackPayload` with `pushed_at?: string`. Set it in the container from the fetch you already pay for. Delete the callback fetch entirely. One source of truth, zero extra latency on the success path.

This is the highest-leverage simplification in the diff.

---

## 3. Spaghetti / Branching Growth

The scheduler loop itself is still readable — one `if (decision.action === "skip")` branch is fine. The spaghetti is in the **data model**, not the conditional: fake completed jobs, a new run status, and duplicate schedule-advancement logic are three parallel concepts for one decision.

Duplicate `next_run_at` calculation appears twice in `handleScheduledEvent` (in `recordSkippedBackup` and the enqueue path). Extract `advanceNextRunAt(repo, fromMs)` and call it from both paths — or delete the skip path's copy when you judo to "advance only."

---

## 4. Boundary / Type / Contract Issues

### `checkScheduledBackup` — borderline, keep for now

Three-line wrapper over pure `evaluateBackupNeed`. Thin, but it owns the I/O boundary and keeps the scheduler testable via `fetch` mock. Not worth fighting unless you inline and test through the scheduler only.

### `github_unreachable` → run anyway

Fail-open is defensible, but it's a policy decision buried in a pure function with no comment or test asserting the intent beyond one case. Fine for now; document why skip-on-unreachable isn't chosen (rate limits? stale cache?).

### `fetchGitHubRepoState` returns `null` on any failure

Callers can't distinguish 404 vs 401 vs rate limit. Acceptable at this layer size, but `repos.ts` POST needs rich error messages while scheduler/callback need silent fail-open — consider two functions or a Result type if this grows.

---

## 5. File Size

All files well under 1k. No concern. `api.test.ts` at 631 is getting plump but not blocking.

---

## 6. Modularity / Canonical Layer Reuse

### Should fix: `repos.ts` POST ignores `github.ts`

Lines 42–50 duplicate the exact fetch in `github.ts`. This diff introduced the canonical helper and didn't wire the obvious caller. One-line fix relative to the feature — do it in this PR.

### Should fix: duplicated `applyMigrations` in tests

Identical DDL copied into `test/api.test.ts` and `test/scheduler.test.ts`. Third copy incoming on every schema change. Extract `test/helpers/migrations.ts` or a shared fixture. Not a ship blocker, but this pattern rots fast.

---

## 7. Legibility / Maintainability

**Weak spots:**

- Skip path creates DB noise (1 job + 1 run per unchanged tick per repo).
- Callback success path adds async GitHub I/O after R2 write — extra failure surface on a path that should be "persist outcome and return".
- Manual trigger bypasses change detection entirely (probably correct for manual, but undocumented).

---

## Focus Area Answers

| #   | Question                             | Answer                                                                                     |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1   | job completed + run skipped?         | **Wrong model.** Semantic lie. Use skip-only schedule advance, or `job.status: "skipped"`. |
| 2   | Avoid creating jobs on skip?         | **Yes.** Strongest code-judo move in this diff.                                            |
| 3   | Duplicate `next_run_at`?             | Extract helper; trivial fix.                                                               |
| 4   | `github.ts` not reused in POST?      | Fix now — diff introduced the helper.                                                      |
| 5   | `checkScheduledBackup` earning keep? | Marginal yes; not a blocker.                                                               |
| 6   | Callback GitHub fetch?               | **No.** Pass `pushed_at` from container payload.                                           |
| 7   | Test migration duplication?          | Extract shared helper.                                                                     |
| 8   | `last_run` + skipped?                | **Yes, broken UX** unless filtered or skips aren't persisted.                              |
| 9   | Atomicity of skip writes?            | **Blocker** — partial failure wedges repo.                                                 |
| 10  | Overall judo?                        | Skip-without-job + payload `pushed_at` deletes ~40 lines and two concepts.                 |

---

## Recommended Restructuring

Preserve behavior, delete complexity:

```
scheduler due repo
  → fetch pushed_at (github.ts)
  → evaluateBackupNeed (pure)
  → skip: UPDATE repos SET next_run_at = … ONLY
  → run:   existing enqueue path + shared advanceNextRunAt

container complete callback
  → payload includes pushed_at (from existing metadata fetch)
  → UPDATE repos SET last_pushed_at, last_backup_at (no worker-side GH fetch)
```

---

## Blockers (must fix before approve)

1. **Skip persistence model** — drop fake completed jobs, or fix semantics + `last_run` filtering
2. **Atomic skip writes** — batch/transaction, or single-write skip model
3. **Redundant callback GitHub fetch** — use container-provided `pushed_at`

## Strong Recommendations (same PR if possible)

4. Wire `repos.ts` POST through `fetchGitHubRepoState`
5. Extract `advanceNextRunAt` helper
6. Shared test migrations helper

---

## Bottom Line

The decision engine is solid. The orchestration layer adds fake entities, duplicate network calls, and non-atomic writes to solve a problem that is really "compare timestamps, maybe advance a clock." Reframe before merge.
