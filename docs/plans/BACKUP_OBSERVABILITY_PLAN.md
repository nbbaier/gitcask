# Backup Observability Plan
## Status
Proposed for implementation on `feature/backup-observability`. Scope is limited to making the existing Queue-based backup pipeline diagnosable. It does **not** change the orchestration engine.

The separate question of whether to replace the custom orchestration with Cloudflare Workflows is deferred — see [BACKUP_ORCHESTRATION_ENGINE.md](./BACKUP_ORCHESTRATION_ENGINE.md).
## Problem
A production incident displayed a backup job as `running` with no stage, heartbeat, or terminal evidence. Today, `running` may mean any of:

- The Queue consumer is trying to dispatch work to the container.
  
- The container accepted work but has not emitted progress.
  
- Clone, archive, hash, upload, or metadata work is in progress.
  
- The container died or callback connectivity failed.
  
- The Worker is waiting for a terminal callback that will never arrive.
  

The lifecycle is distributed across cron/manual job creation, Queue delivery, container-side work, and best-effort progress callbacks. Recent container job history lives only in process memory and disappears on restart. A 15-minute deadline sweep detects failure too late and cannot explain where progress stopped.
## Goal
After this work, an active job can be classified — using D1/API data alone — as one of:

- waiting for the container executor
  
- dispatching to the container
  
- actively executing a known stage (with stage start time and last heartbeat)
  
- stale (heartbeat exceeded threshold)
  
- succeeded
  
- failed (with a categorized reason)
  

Operators and the CLI/API surface should be able to answer "what is this job doing right now, and when did it last make progress?" without reading Cloudflare dashboard logs.
## Non-Goals
- Replacing the Queue consumer or introducing Cloudflare Workflows.
  
- Resuming an interrupted `git clone` or partial R2 upload.
  
- Decomposing the container pipeline into persisted intermediate artifacts.
  
- Treating Cloudflare dashboard logs as the product-facing job history.
  
## Proposed Changes
### 1. Job Status and Stage Model
Two columns describe a job's current position in the lifecycle:

`status` — coarse-grained lifecycle position. Migrated from `queued | running | completed | failed` to rename `completed` to `succeeded` and add `dispatching` and `cancelled`:

```typescript
type JobStatus =
   | "queued"        // created, not yet picked up by the consumer
   | "dispatching"   // consumer is acquiring executor and calling container
   | "running"       // container has accepted; phase work in progress
   | "succeeded"
   | "failed"
   | "cancelled";    // user-initiated termination
```

`cancelled` is a distinct terminal status, not a flavor of `failed`. User intent (cancellation) is conceptually different from system error (failure), and consumers should check `status` alone to distinguish them rather than parsing event details.

`stage` — fine-grained position within `dispatching` or `running`. Extends the existing 6-value enum to add `waiting_for_executor`, `container_accepted`, and `finalizing`:

```ts
type JobStage =
   | "dispatching" // status=dispatching, calling container
   | "container_accepted" // status=running, no phase yet
   | "cloning" // status=running
   | "archiving" // status=running
   | "hashing" // status=running
   | "uploading" // status=running
   | "fetching_metadata" // status=running
   | "uploading_metadata" // status=running
   | "finalizing"; // status=running
```

The job is no longer marked `running` before the container has accepted dispatch — that interval is `status=dispatching, stage=dispatching`. CLI/API surfaces render `(status, stage)` together.

`jobs.stage_updated_at` (already present) records when the current stage was entered.

This branch also sets the queue consumer to `max_concurrency: 1` so the Container Executor serializes naturally and "waiting for the executor" is not a distinct Job stage — it is simply Queue depth. The future decision to introduce multiple Container instances is deferred (see [BACKUP_ORCHESTRATION_ENGINE.md](./BACKUP_ORCHESTRATION_ENGINE.md) and the parallelism handoff for context).
### 2. Durable Event History
Add a D1 `job_events` table. Each row records:

| Field         | Purpose                                      |
| ------------- | -------------------------------------------- |
| `id`          | Unique event identity for stable reads       |
| `job_id`      | Parent job                                   |
| `occurred_at` | Server-recorded timestamp                    |
| `source`      | `trigger`, `queue`, `container`, or `worker` |
| `event_type`  | Stable event name such as `dispatch_started` |
| `stage`       | Optional current stage snapshot              |
| `attempt`     | Attempt associated with the event            |
| `elapsed_ms`  | Optional phase duration                      |
| `detail_json` | Optional sanitized structured details        |
| `error`       | Optional safe error summary                  |

Safe event details may include object size, phase duration, HTTP status, or timeout category. They must **not** include GitHub PATs, callback tokens, R2 credentials, clone URLs containing credentials, or full secret-bearing payloads.

This replaces the in-memory container debug buffer for product-facing history. Raw container logs remain available in Cloudflare observability for operators.

The seed `event_type` vocabulary (strict enum):

| event_type           | typical source | when it fires                        |
| -------------------- | -------------- | ------------------------------------ |
| `job_created`        | trigger        | Job row inserted, about to enqueue   |
| `dispatch_started`   | queue          | Consumer begins calling container    |
| `dispatch_failed`    | queue          | Container couldn't be dispatched to  |
| `container_accepted` | queue          | Container returned `202`             |
| `phase_started`      | container      | A Phase began                        |
| `phase_completed`    | container      | A Phase finished cleanly             |
| `phase_failed`       | container      | A Phase errored                      |
| `heartbeat`          | container      | Liveness during a long Phase         |
| `terminal_success`   | container      | Final callback: success              |
| `terminal_failure`   | container      | Final callback: failure              |
| `deadline_swept`     | worker         | Sweep transitioned Job to failed     |
| `retry_scheduled`    | worker         | About to bump `attempt` and re-queue |
| `gave_up`            | worker         | Exhausted `MAX_ATTEMPTS`             |
| `cancelled`          | worker         | User invoked `POST /jobs/:id/cancel` |

All except `heartbeat` are _boundary events_ — they cause a Stage or Status transition. `heartbeat` is the only within-stage event. `cancelled` transitions the Job to `status=cancelled`; an in-flight container will keep working and its eventual terminal callback is silently ignored by the idempotency guard (see Section 5). Container-side cancellation propagation is a separate piece of work — see the container-cancellation handoff.

Failure categories are not their own event types — they live in `detail_json.category` on the relevant terminal event. The four categories:

- `executor_unavailable` — container could not be reached (on `dispatch_failed`)
  
- `dispatch_timeout` — container did not accept within the timeout (on `dispatch_failed`)
  
- `container_rejected` — container returned non-2xx (on `dispatch_failed`)
  
- `container_error` — terminal callback reported failure (on `terminal_failure`)
  
- `heartbeat_timeout` — no events within `deadline_at` window (on `deadline_swept`)
  

The plan's earlier separate `callback_timeout` category collapses into `heartbeat_timeout`: under a single `last_event_at` liveness signal, "no callback" and "no progress" are the same condition.
### 3. Job Activity Summary
Add `last_event_at` to `jobs`. It is updated every time a Job Event is written, regardless of event type. It is the single signal for:

- **Staleness display** — read API computes `is_stale` as `now - last_event_at > threshold`.
  
- **Deadline refresh** — `deadline_at` is recomputed from `last_event_at` whenever the latter is written. A healthy long-running Job keeps extending its deadline; a silent Job hits the deadline and is swept to `failed` (reason: `heartbeat_timeout`).
  

Heartbeats are themselves Job Events, so they refresh `last_event_at` like any other event. There is no separate `last_heartbeat_at` column — that would denormalize the same signal. If a reader specifically wants the most recent heartbeat (for diagnostic display), they query `job_events WHERE event_type='heartbeat' ORDER BY occurred_at DESC LIMIT 1`.

`stage_updated_at` is already present and records when the current stage was entered.
### 4. Container Progress and Heartbeats
The container sends authenticated progress updates to the Worker during active execution:

```typescript
type BackupProgressEvent =
   | {
        kind: "phase_started";
        stage: JobStage;
        occurred_at: string;
     }
   | {
        kind: "heartbeat";
        stage: JobStage;
        elapsed_ms: number;
        occurred_at: string;
     }
   | {
        kind: "phase_completed";
        stage: JobStage;
        elapsed_ms: number;
        occurred_at: string;
        size_bytes?: number;
     }
   | {
        kind: "phase_failed";
        stage: JobStage;
        elapsed_ms: number;
        occurred_at: string;
        error: string;
     };
```

- Phase-start event before each container operation.
  
- Phase-completion event with elapsed duration after each successful operation.
  
- Phase-failed event with elapsed duration and error before the container sends its `terminal_failure` callback. This gives the Event timeline an explicit boundary for which Phase died, rather than requiring the Worker to infer it from the Job's last-known stage.
  
- Heartbeats at a bounded interval during long-running operations (clone, upload) where silence is otherwise ambiguous.
  
- Heartbeat emission stops in `finally` cleanup when a phase finishes or fails.
  

Exact heartbeat interval and stale threshold are deferred until production data from the first wave of instrumentation is available.
### 5. Terminal Callback Idempotency
The container may retry its terminal callback (transient network failure on the first attempt). The Worker handler guards by `jobs.status`: if the Job is already in any terminal status (`succeeded`, `failed`, or `cancelled`), the callback is ignored entirely — no new Event written, no Outcome re-written. The first terminal callback wins; duplicates are silently no-ops. This also handles the cancellation race: a cancel that beats the container's terminal callback wins; the container's later callback is dropped.

This relies on the Worker handler being the single writer of terminal state transitions. Phase events (`phase_started`/`phase_completed`/`phase_failed`) and `heartbeat` Events are _not_ deduplicated; duplicates are harmless (idempotent on `last_event_at`, no Stage transition past completion) and the deduplication cost outweighs the benefit.
### 6. Dispatch Timeout
The Queue consumer's dispatch to the container receives a short, explicit timeout rather than relying on the deadline sweep. On timeout, a `dispatch_failed` Job Event is written with `detail_json.category = "dispatch_timeout"` before the Job transitions toward retry or failure.

The full failure category vocabulary is defined in Section 2 alongside the `event_type` enum.
### 7. In-flight Job Read API
`GET /jobs/:id` and `GET /jobs?repo_id=X` already exist and serve in-flight Jobs. This work extends them rather than adding new routes:

- `GET /jobs/:id` — already returns the Job row. Extend the response to include `last_event_at`, a derived `is_stale` flag, and a recent slice of `job_events` (most recent N, newest first).
  
- `GET /jobs?repo_id=X` — already returns active Jobs filtered by repo. Extend the projection to include `last_event_at`. With `max_concurrency: 1` the active set is always 0 or 1 Jobs.
  

`/runs` (the Outcome list) keeps its current meaning: finalized history. The conceptual separation between in-flight Jobs and terminal Outcomes is recorded in [ADR-0001](../adr/0001-in-flight-jobs-separate-from-outcomes.md).
### 8. Diagnostic Routes
The currently-public debug routes on `/health` are tightened:

- `POST /debug/connectivity` — kept, moved under `adminAuth` (re-mounted on the admin-authenticated router rather than the public `/health` router). It is a real operator diagnostic and worth keeping; it just shouldn't be reachable unauthenticated.
  
- `GET /debug/container-jobs` — removed. It exposes the container's in-memory job tracker; that buffer is exactly the "lost on restart" failure mode this plan addresses. The durable Job Event timeline on `GET /jobs/:id` is the replacement.
  
- **Container-side** `GET /debug/jobs` — removed alongside its proxy.
  
- **The container's in-memory** `trackJob` **buffer** — removed entirely. Anything diagnostic that used to live there now lives as a Job Event.
  
## Migration and Backfill
Schema migration adds:

- `jobs.last_event_at` (nullable text).
  
- `jobs.status` enum values `dispatching` and `cancelled`.
  
- `jobs.stage` enum values `dispatching`, `container_accepted`, `finalizing`.
  
- `runs.status` enum renames `completed` to `succeeded` and adds `cancelled` (final set: `running`, `succeeded`, `failed`, `cancelled`).
  
- New `job_events` table with the indexes described in Section 2.
  

`POST /jobs/:id/cancel` is updated to:

- Set `jobs.status = "cancelled"`.
  
- Write a `cancelled` Job Event.
  
- Write an Outcome with `runs.status = "cancelled"` and `error = null`. Cancellation is intent, not error — `error` should not be populated.
  

This requires migrating the `runs.status` enum (rename `completed` to `succeeded`, add `cancelled`).
## Retention
`job_events` share the existing Outcome retention window (`RUN_METADATA_TTL_DAYS = 180`). The retention sweep in `services/retention.ts` adds one step: delete `job_events` rows for any `job_id` being swept (both stale Outcomes and stale terminal Jobs without Outcomes) _before_ the existing row deletions. Same tick, same window — the Event timeline disappears with its Job.

The terminal-Job sweep (currently at retention.ts lines 89–106) only removes `status=completed` and `status=failed` Jobs. It must be updated to use the renamed `status=succeeded` and to also include `status=cancelled` Jobs, otherwise cancelled Jobs without Outcomes never get reaped.

In-flight Jobs keep all their Events as long as the Job row exists; the retention clock only starts once the Job becomes terminal.

**No backfill** of existing Jobs or Outcomes. Pre-migration `runs` rows have no synthetic Events generated for them; pre-migration Jobs have `last_event_at = null` permanently. The read API simply shows what is there — old Outcomes look as they always have, new Jobs get full timelines. Synthesising sparse Events from `runs` row timestamps would misrepresent the level of detail actually available.
## Validation
The implementation is complete when each of the following is observable through D1/API data alone:

1. A successful backup emits `dispatch_started`, `container_accepted`, per-Phase `phase_started`/`phase_completed`, optional `heartbeat`s, and `terminal_success` Events.
  
2. Container dispatch timeout produces a `dispatch_failed` Event with `category = "dispatch_timeout"` and no ambiguous `running` interval.
  
3. A container that dies before sending a terminal callback produces a `deadline_swept` Event with `category = "heartbeat_timeout"` within a bounded time.
  
4. An in-flight Job's `is_stale` flag (derived from `last_event_at`) distinguishes silent Jobs from active-but-slow Phases.
  
5. CLI/API views display current `(status, stage)`, time since `last_event_at`, attempt count, and a sanitized Event history adequate for support diagnosis.
  
## Open Review Points
- Heartbeat interval and stale threshold — set after first production data.
  
- Dispatch timeout value — set from observed container accept latency.
  
## Known Limitations Not Addressed Here
- **Container death during a Job is detected only by deadline sweep.** The container runs `processBackup` as a floating promise; if the container restarts (deploy, OOM, eviction), in-flight Jobs go silent and recover only when `deadline_swept` fires. The observability captures this gap (visible as "no events for N minutes, then `deadline_swept`") but does not shorten the detection latency. A faster startup-recovery sweep is a separate piece of work — see the container-restart-recovery handoff for context.
  
## Cloudflare References
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
  
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
