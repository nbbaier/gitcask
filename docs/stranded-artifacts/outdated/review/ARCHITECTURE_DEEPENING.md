# Architecture Deepening Pass (May 2026)

A pass over the codebase looking for shallow modules — places where the interface costs nearly as much as the implementation — and extracting deeper seams that concentrate complexity instead of moving it around.

## What landed

### Candidate 1 — JobLifecycle ([#3](https://github.com/nbbaier/gitcask/pull/3))

Centralised the Job status state machine into [src/services/job-lifecycle.ts](../src/services/job-lifecycle.ts). Five transitions (`markRunning`, `markCompleted`, `recordFailure`, `markFailedByDeadline`, `cancel`) replaced hand-written `UPDATE` blocks in callback, queue consumer, manual cancel, and the scheduler's deadline sweep.

Fixed-in-flight bugs the convention-based clearing had been masking:
- `cancel` and `markCompleted` now clear `deadline_at`.
- Queue dispatch-failure now creates a Run record.
- Permanent give-up now fires the failure webhook from the consumer path.
- `markRunning` now validates expected `attempt` and uses an atomic conditional UPDATE — closes the duplicate-message race.
- Retry `FailureOutcome` carries `repoId` / `idempotencyKey` / `triggerSource`, removing a second DB SELECT and its silent-drop window.

### Candidate 2 — BackupDispatcher ([#5](https://github.com/nbbaier/gitcask/pull/5))

Extracted the inline container call from the queue consumer into [src/services/backup-dispatcher.ts](../src/services/backup-dispatcher.ts). Pure I/O — builds `ContainerRequest`, picks the Container DO, posts `/backup`, classifies the response into a `DispatchResult`. Consumer reacts to the outcome.

Result: **lifecycle owns state, dispatcher owns I/O, consumer orchestrates both**.

## What we deferred

### Candidate 3 — Per-aggregate Stores (skipped)

The original report proposed `Repo` / `Job` / `Run` / `Artifact` stores. After 1 + 2 merged, the residual duplication was only `findRepoById` across 3 callsites — `JobLifecycle` had absorbed all the Job/Run writes. Building four stores so each module owns one query would have been the generic-DAO trap the report itself warned against.

**Re-open if:** schema renames on `repos` start causing pain at more than ~5 callsites, or a second cross-cutting query (e.g. "find latest successful run for repo") appears in 3+ places.

### Candidate 4 — ArtifactStore (deferred)

R2 layout convention (`repos/{owner}/{name}/snapshots/…` + `latest.json`) is encoded in three places: `callback.ts` (write `latest.json`), `repos.ts` (cascade-delete on repo deletion), `retention.ts` (age-based + TTL deletion). Today this is bearable.

**Re-open if:** any of the following — artifact versioning, signed-URL downloads, per-repo quotas, R2 layout migration, or a fourth caller of R2 enters the codebase.

### Candidate 5 — BackupDecisionService (deferred)

`scheduler.ts` calls GitHub inline per repo with no batching, caching, or circuit breaker. Today `evaluateBackupNeed` is already a clean pure function and per-repo I/O is fine at current repo counts.

**Re-open if:** scheduler tick latency becomes a concern, GitHub rate-limiting starts mattering, or we want per-repo policy (e.g. force-backup overrides, different cadences for high-churn repos).

## Test coverage gaps (concrete follow-up)

Copilot flagged on #3, not addressed in the refactor PRs to keep the diff focused:

- No test covers the scheduler's deadline sweep — `markFailedByDeadline` transitioning a stuck `running` job to `failed` with a Run record.
- No test covers `POST /jobs/:id/cancel` — 200 on queued/running, 409 on completed/failed, Run row with cancellation error.

Both belong in a small `test: backfill lifecycle coverage` PR rather than as part of any future deepening work.

## Principles applied

From the [improve-codebase-architecture](https://github.com/anthropic/claude-skills/) skill's language:

- **Deep modules**: a small interface hiding meaningful behaviour. JobLifecycle's five-verb interface hides field-clearing rules, retry policy, conditional UPDATE atomicity.
- **Seams**: places where behaviour can be altered without editing in place. The dispatcher's `DispatchResult` is the seam between Worker and Container.
- **Deletion test**: would deleting the module concentrate complexity (kept) or just move it (cut)? Candidate 3 failed this test post-1+2; candidates 4 and 5 currently fail it too.
