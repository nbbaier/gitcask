# Backup Observability Artifact

Source branch: `feat/backup-observability`

Status: salvage note. This is a distilled version of the branch's glossary,
observability plan, orchestration memo, and ADR. It is not yet an accepted
implementation plan.

## Why It Matters

The current system can leave an operator staring at a job marked `running`
without enough durable evidence to know whether the Worker is dispatching,
the container accepted, a clone/upload is still active, the callback failed,
or the container died.

The useful idea from the branch is not "rename everything now." It is this:
make job progress reconstructable from D1/API data alone, without relying on
Cloudflare dashboard logs or the container's in-memory debug buffer.

## Vocabulary To Preserve

- **Repo:** a GitHub repository tracked for backup, identified by `(owner, name)`.
- **Job:** the lifecycle of one backup request from creation to terminal state.
  A Job may have multiple retry attempts.
- **Outcome:** the terminal record of a Job. The current `runs` table is an
  Outcome table in practice, even though its name predates this terminology.
- **Artifact:** a persisted backup output in R2 linked to an Outcome.
- **Dispatch:** the Queue consumer handing a Job to the container executor.
  Dispatch is distinct from container execution.
- **Stage:** fine-grained position within the lifecycle, such as `cloning`,
  `uploading`, or `finalizing`.
- **Job Event:** append-only record of a boundary or liveness event for a Job.
- **Heartbeat:** within-stage liveness event for long phases. It refreshes
  `last_event_at` but does not change the Stage.

## Event Model

The branch proposed a `job_events` table with an event vocabulary like:

- `job_created`
- `dispatch_started`
- `dispatch_failed`
- `container_accepted`
- `phase_started`
- `phase_completed`
- `phase_failed`
- `heartbeat`
- `terminal_success`
- `terminal_failure`
- `deadline_swept`
- `retry_scheduled`
- `gave_up`
- `cancelled`

Most events are boundary events that explain a status or stage transition.
`heartbeat` is intentionally different: it is a liveness signal while a long
phase is still in progress.

Safe details can include object size, phase duration, HTTP status, timeout
category, or sanitized error summaries. They must not include GitHub PATs,
callback tokens, R2 credentials, clone URLs containing credentials, or full
secret-bearing payloads.

## Schema Ideas

Candidate additions:

- `jobs.last_event_at`
- `job_events`
  - `id`
  - `job_id`
  - `occurred_at`
  - `source` (`trigger`, `queue`, `container`, `worker`)
  - `event_type`
  - `stage`
  - `attempt`
  - `elapsed_ms`
  - `detail_json`
  - `error`

The branch also proposed status vocabulary changes (`dispatching`,
`succeeded`, `cancelled`) and a cleaner separation between in-flight Jobs and
terminal Outcomes. Those changes need a fresh migration plan before adoption.

## API Ideas

Extend the existing job routes rather than inventing a parallel surface:

- `GET /jobs/:id`
  - include `last_event_at`
  - include derived `is_stale`
  - include the most recent Job Events
- `GET /jobs?repo_id=...`
  - include `last_event_at`
  - keep it focused on active/in-flight work

Keep `/runs` for finalized Outcome history.

## Operational Payoff

This work should let operators and a demo audience answer:

- What is this job doing now?
- When did it last make progress?
- Did the container accept the job?
- Which phase failed?
- Is this job slow but alive, or stale?
- Did retries happen, and why?

## Relationship To Existing Plans

- The completed Phase 0
  [June sprint plan](../plans/2026-06-23-001-feat-june-sprint-honest-landing-plan.md)
  (shipped in PR #20) superseded the archived verification-baseline plan; this
  observability work is now a Phase 1 planning input.
- Coordinate with the archived
  [debug-endpoint plan](./outdated/plans/003-auth-gate-debug-endpoints.md);
  durable Job Events should replace the public container job debug buffer. The
  completed June plan made the immediate go-live decision on this.
- Coordinate with the archived
  [stuck-queued-jobs plan](./outdated/plans/004-rescue-stuck-queued-jobs.md);
  stale queued/running behavior should be reflected in the event model.

## Deferred Orchestration Question

The branch also preserved a Cloudflare Workflows decision memo. The useful
conclusion was: keep the Queue-based engine for now, and revisit Workflows
only if custom retry/deadline/callback code remains a recurring source of
bugs after observability improves.
