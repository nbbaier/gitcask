# Backup Workflows and Progress Observability Decision Memo

## Status

Proposed architecture for review. This document recommends a direction; it does
not implement application changes, migrations, or production deployment.

## Decision Summary

Adopt **Cloudflare Workflows as the durable orchestrator for backup jobs** while
retaining **D1 as the application-facing activity and progress history**. Keep
the existing Cloudflare Container as the executor for clone, archive, hashing,
upload, and metadata collection.

The recommended migration is incremental:

1. Add granular progress vocabulary, dispatch timeouts, heartbeats, and durable
   D1 job events to the current path.
2. Route manual backup jobs through a `BackupWorkflow` using the existing
   container endpoint.
3. Route scheduled backup jobs directly into Workflows and retire Queues from
   the primary backup dispatch path.
4. Remove obsolete custom retry/deadline orchestration after production
   verification.

## Problem Statement

The current backup lifecycle is distributed across:

- Cron/manual job creation in the Worker.
- Cloudflare Queue delivery and dispatch to one named container executor.
- Container-side clone/archive/upload work with best-effort progress callbacks.
- D1 job and run rows plus an in-memory container debug buffer.

The production incident exposed an observability gap: a job can be displayed as
`running` with no stage or heartbeat even when container work has not actually
begun. Today, `running` may mean:

- The Queue consumer is trying to dispatch work to the container.
- The container accepted work but has not emitted progress.
- Clone, archive, hash, upload, or metadata work is in progress.
- The container died or callback connectivity failed.
- The Worker is waiting for a terminal callback that will never arrive.

### Current Limitations

- The job is marked `running` before container dispatch completes.
- Container dispatch does not have a short application-level timeout.
- The container reports only phase starts, not completion durations or
  continuous liveness during long operations.
- Progress callbacks are best-effort; callback failure leaves D1 without useful
  evidence.
- Recent container job history is stored only in memory and disappears on
  restart or instance replacement.
- A final 15-minute deadline sweep detects failure too late and cannot explain
  where progress stopped.
- A single named container executor exists, but the admission/concurrency model
  is not made explicit in job state.

## Goals and Non-Goals

### Goals

- Distinguish dispatch delay, active container work, callback waiting, and
  terminal failure in the API and CLI.
- Preserve a durable, queryable activity history for each job.
- Make retry, timeout, busy-container, and stale-progress outcomes explicit.
- Use Cloudflare-native durable orchestration for steps that may retry or wait
  on external completion.
- Retain safe, bounded execution through the existing single container
  executor during initial migration.
- Preserve existing backup artifacts and readable historical job/run data.

### Non-Goals

- Resume an interrupted `git clone` partway through network transfer.
- Resume a partially uploaded single R2 object without redesigning uploads.
- Decompose the container pipeline into persisted intermediate artifacts in the
  first Workflows adoption.
- Treat Cloudflare dashboard logs as the product-facing job history.

## Options

### Option A: Instrument the Existing Queue Architecture

Retain the current Queue consumer and D1 lifecycle ownership. Add structured
progress events and operational safeguards:

- Introduce orchestration stages such as `dispatching` and
  `container_accepted`.
- Add a short timeout around container dispatch.
- Store durable `job_events` rows and heartbeat activity.
- Report container phase starts, completions, durations, and errors.
- Make single-container admission visible in the existing queue path.

**Advantages**

- Smallest architecture change.
- Fastest route to better diagnostics.
- Preserves all existing control flow and deployment bindings.

**Disadvantages**

- Continues maintaining a custom workflow engine in D1, Queue code, callbacks,
  deadlines, and retry transitions.
- Durable waiting for external results remains hand-built.
- Future cancellation, recovery, and operator tooling continue to require
  bespoke lifecycle work.

### Option B: Workflows Orchestrator with Existing Container Executor (Recommended)

Create one Workflow instance per backup job. The Workflow owns durable
orchestration, retries, waits, and terminal flow; the container continues to
execute the backup pipeline. D1 stores job summaries and event history for the
API/CLI.

```text
Manual trigger or cron
  -> create D1 job and Workflow instance using the job ID
  -> Workflow step: acquire single-container admission
  -> Workflow step: dispatch container with a short timeout
  -> Workflow waitForEvent: await terminal backup result
  -> Container: emit progress and heartbeat updates to Worker/D1
  -> Worker: record result and deliver backup_result event to Workflow
  -> Workflow step: persist artifact/latest pointer exactly once
  -> Workflow step: release admission and notify on terminal failure
```

**Advantages**

- Clearly identifies whether a backup is dispatching, waiting, retrying, or
  complete.
- Replaces custom cross-module orchestration with durable Workflow steps and
  event waits.
- Allows step-level retries/timeouts while preserving app-facing D1 history.
- Supports incremental adoption: the container need not be rewritten first.
- Uses Cloudflare Workflow observability alongside structured application
  events.

**Disadvantages**

- Requires a new Workflow binding, callback/event bridge, schema evolution,
  and migration of trigger paths.
- Requires care to make D1/R2 side effects idempotent under Workflow retries.
- Does not resume an interrupted clone or single upload within the container.

### Option C: Fully Decomposed Workflow and Container Pipeline

Move clone, archive, hashing, upload, and metadata into separately recoverable
units, backed by persisted intermediate state or workspaces. The Workflow could
resume after individual completed units rather than replaying the entire
container pipeline.

**Advantages**

- Strongest recovery boundaries for large repositories or expensive transfers.
- Fine-grained duration, retry, and operational accounting.

**Disadvantages**

- Significantly changes artifact ownership, intermediate cleanup, security, and
  storage requirements.
- Adds complexity before the current backup volume demonstrates a need for
  partial-operation resume.

**Decision**

Defer Option C. Revisit only if large backup transfers routinely fail after
substantial elapsed time, or if replaying a whole container run is materially
expensive.

## Option Comparison

| Criterion                            | Option A: Improve Queue     | Option B: Workflows + Container | Option C: Decomposed Pipeline   |
| ------------------------------------ | --------------------------- | ------------------------------- | ------------------------------- |
| Diagnose dispatch versus active work | Good                        | Excellent                       | Excellent                       |
| Durable retries/timeouts/waiting     | Custom                      | Native orchestration            | Native orchestration            |
| Resume between orchestration steps   | Limited                     | Good                            | Excellent                       |
| Resume within clone/upload           | No                          | No                              | Potentially                     |
| Migration complexity                 | Low                         | Moderate                        | High                            |
| Single-container admission clarity   | Must add                    | Natural Workflow step           | Must redesign execution pool    |
| Product-facing D1 history            | Straightforward             | Straightforward                 | Straightforward                 |
| Cloudflare operator visibility       | Logs only plus custom state | Workflow steps plus logs/events | Workflow steps plus logs/events |
| Recommended now                      | Interim work only           | Yes                             | No                              |

## Recommended Target Design

### Orchestration Ownership

- A `BackupWorkflow` instance owns the lifecycle for each triggered backup.
- The Workflow instance ID is deterministic and maps to the application job
  ID, preventing duplicate orchestrations for one job.
- Manual and scheduled triggers use the same workflow creation path.
- The Queue is retired from the primary backup path once both trigger paths
  have migrated and production validation is complete.

### Container Admission

- Preserve the existing single named container executor initially.
- Permit only one actively executing backup at a time.
- Model admission as a durable Workflow step with visible outcomes:
  `acquired`, `busy_waiting`, `busy_timeout`, or `released`.
- A workflow waiting for the executor remains distinguishable from a workflow
  whose container operation is actively running.

This intentionally favors predictable behavior over introducing multi-container
parallelism during the observability and orchestration change.

### Resumability Boundary

- Workflow durability applies to preparation, admission, dispatch, waiting for
  terminal result, final persistence, and notification.
- A container retry starts clone/archive/upload again from the beginning.
- R2 artifact writing and latest-pointer persistence must be idempotent so a
  retried finalization step cannot create duplicate state.

### Product and Operator Visibility

- D1 is the source of truth for user-visible job state, event timelines,
  heartbeats, error summaries, and CLI/API reads.
- Workflow instance history is the source for orchestration execution,
  durable-wait, timeout, and retry diagnosis by operators.
- Workers/Containers observability logs retain raw operational output and
  stack-level failure evidence.

## Proposed Interfaces and Data Contracts

These contracts are recommendations for later implementation, not migrations
included in this document branch.

### Job Summary

Extend visible job state with orchestration-aware progress:

```typescript
type JobStage =
   | "waiting_for_executor"
   | "dispatching"
   | "container_accepted"
   | "cloning"
   | "archiving"
   | "hashing"
   | "uploading"
   | "fetching_metadata"
   | "uploading_metadata"
   | "waiting_for_result"
   | "finalizing";
```

Add summary timestamps suitable for list/detail views:

```typescript
interface JobActivitySummary {
   last_event_at: string | null;
   last_heartbeat_at: string | null;
   stage_started_at: string | null;
   workflow_instance_id: string | null;
}
```

### Durable Event Timeline

Add a D1 `job_events` history table or equivalent store. Each row records:

| Field         | Purpose                                         |
| ------------- | ----------------------------------------------- |
| `id`          | Unique event identity for stable reads          |
| `job_id`      | Parent job                                      |
| `occurred_at` | Server-recorded timestamp                       |
| `source`      | `trigger`, `workflow`, `container`, or `worker` |
| `event_type`  | Stable event name such as `dispatch_started`    |
| `stage`       | Optional current stage snapshot                 |
| `attempt`     | Attempt associated with the event               |
| `elapsed_ms`  | Optional phase or workflow-step duration        |
| `detail_json` | Optional sanitized structured details           |
| `error`       | Optional safe error summary                     |

Safe event details may include object size, phase duration, HTTP status, or
timeout category. They must not include GitHub PATs, callback tokens, R2
credentials, clone URLs containing credentials, or full secret-bearing
payloads.

### Progress and Heartbeat Reporting

The container should send authenticated progress updates to the Worker during
active execution:

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
     };
```

- Send a phase-start event before each container operation.
- Send phase-completion events with elapsed duration after each operation.
- Send heartbeats at a bounded interval during clone and upload operations
  where silence is otherwise ambiguous.
- Stop heartbeat emission in `finally` cleanup when a phase finishes or fails.

### Terminal Result Bridge

- The container continues sending authenticated terminal success/failure to a
  Worker endpoint.
- The Worker writes a terminal `job_events` entry and delivers a
  `backup_result` event to the corresponding Workflow instance.
- The Workflow finalizes D1/R2 state exactly once after receiving that event.
- Duplicate terminal callbacks are treated idempotently and retained only as
  safe diagnostic evidence where useful.

### Dispatch Timeouts and Busy Outcomes

- Dispatch from Workflow to container receives a short explicit timeout rather
  than relying on a broad terminal job deadline.
- Container unavailability, admission contention, dispatch timeout, and
  container rejection are distinguishable event types.
- A Workflow retry records its attempt and reason before retrying, so the UI
  does not display silent `running` gaps.

### Diagnostics Security

- Protect existing container diagnostic proxy routes with admin
  authentication, or replace them with authenticated job-event inspection.
- Keep raw Cloudflare logs for operators; expose only sanitized state and
  history through the application API.

## Migration Sequence

### Phase 1: Improve Existing Visibility

- Add orchestration-aware job stages and a durable D1 event history.
- Add container progress completion events and heartbeat reporting.
- Add explicit dispatch timeout and visible dispatch failure categories.
- Secure or replace public diagnostic routes.
- Retain existing Queue-backed execution during this phase.

**Exit criteria:** an active job can be classified as waiting, dispatching,
actively executing a known stage, stale, completed, or failed using D1/API
data alone.

### Phase 2: Manual Jobs through Workflows

- Configure a `BackupWorkflow` binding.
- Create workflow instances for manual triggers with deterministic job IDs.
- Use Workflow steps for admission, dispatch, terminal event wait,
  finalization, and failure notification.
- Continue using the existing container protocol plus the new event reporting.

**Exit criteria:** manual triggers complete and fail correctly under workflow
execution, with idempotent persistence and visible event history.

### Phase 3: Scheduled Jobs through Workflows

- Have cron/change-detection create Workflow-backed jobs directly.
- Stop using the Queue for primary scheduled/manual backup execution.
- Keep Queue-related configuration only if it supports a distinct remaining
  workload.

**Exit criteria:** scheduled and manual jobs share one lifecycle and Queue
delivery is no longer required to perform backups.

### Phase 4: Simplify Retired Machinery

- Remove obsolete Queue-consumer backup dispatch and custom orchestration
  retry/deadline logic after production evidence confirms replacement behavior.
- Preserve migrations and read compatibility for historical job/run rows.
- Update operational documentation and dashboard/log troubleshooting guidance.

**Exit criteria:** one documented orchestration path remains, with production
monitoring proving successful backups and diagnosable failures.

## Validation and Rollout Scenarios

Any implementation proposal based on this memo must verify:

1. A successful backup emits dispatch, stage, heartbeat where applicable,
   terminal-result, and finalization evidence; artifact/latest state is
   persisted once.
2. Container dispatch timeout or executor-busy behavior produces visible
   Workflow retries without duplicate backup artifacts.
3. A container that dies before a terminal callback causes an event-wait
   timeout and an explicit terminal failure outcome.
4. A stale heartbeat is distinguishable from an active but slow clone or
   upload.
5. Duplicate callbacks, repeated event delivery, or Workflow step retries do
   not duplicate artifacts, latest pointers, or failure notifications.
6. Two simultaneously due repositories serialize safely through the
   single-active-container admission policy.
7. Manual and scheduled triggers converge on identical Workflow-backed
   lifecycle behavior.
8. Existing completed and failed D1 job/run history remains readable after
   schema evolution.
9. API and CLI views display recent stage, heartbeat recency, attempt, and a
   sanitized event history adequate for support diagnosis.
10.   Cloudflare Dashboard logs and Workflow metrics provide operator evidence
      for container failures, Workflow timeouts, and retry behavior.

## Rollout and Reversal

- Ship Phase 1 independently so visibility improvements benefit the current
  pipeline before orchestration changes.
- Roll out manual Workflow execution first to bound production exposure.
- Preserve the current scheduled path until manual Workflow success/failure
  handling has been observed in production.
- Do not delete Queue-backed code/configuration until all backup entry points
  have stable Workflow evidence and rollback is no longer required.
- If Workflow migration is paused, Phase 1 event history and timeout work
  remains useful without requiring architecture reversal.

## Assumptions and Open Review Points

### Defaults Selected

- Recommended option: **Option B**, Workflows orchestration with the existing
  container executor and D1 activity timeline.
- Admission model: one active backup at a time through the existing named
  container.
- Queue target state: removed from the primary backup path after migration.
- Workflow IDs: deterministic mapping to application job IDs.
- Heartbeats: operational progress retained in D1 rather than represented as
  individual durable Workflow steps.

### Review Points Before Implementation

- Set the exact heartbeat interval and stale threshold based on observed backup
  durations after Phase 1 instrumentation.
- Set dispatch timeout and Workflow event-wait timeout using production
  duration/error data.
- Confirm the implementation mechanism for single-active-container admission
  when designing the Workflow change.
- Confirm whether historical event retention should match run retention or
  require a separate bounded policy.

## Cloudflare References

- [Cloudflare Workflows overview](https://developers.cloudflare.com/workflows/)
- [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
- [Workflows Workers API and event waits](https://developers.cloudflare.com/workflows/build/workers-api/)
- [Rules of Workflows and idempotent side effects](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Workflow metrics and analytics](https://developers.cloudflare.com/workflows/observability/metrics-analytics/)
- [Cloudflare Containers](https://developers.cloudflare.com/containers/)
- [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
