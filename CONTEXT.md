# Project Glossary

Canonical terms for `gitcask`. This document is **only** a glossary — not a
spec, not a roadmap, not a scratch pad. Definitions, nothing else.

## Repo

A GitHub repository tracked for backup. Identified by `(owner, name)`. Rows
in the `repos` table.

## Job

The complete lifecycle of one backup of a Repo, from creation through
terminal state. A single Job may include multiple retry attempts; the
`jobs.attempt` integer tracks which attempt is currently active. Has a
`trigger_source` (`schedule` or `manual`), an `idempotency_key`, and a
position described by `status` and `stage`. Rows in the `jobs` table.

## Status (of a Job)

Coarse-grained lifecycle position. One of:

- `queued` — created, not yet picked up by the consumer.
- `dispatching` — consumer is acquiring the executor and calling the
  container. The Job is **not yet running** on a container.
- `running` — the container has accepted the Job and is executing the
  pipeline.
- `succeeded` — terminal success.
- `failed` — terminal failure, with a categorized reason.
- `cancelled` — terminal, user-initiated. Distinct from `failed`:
  cancellation is intent, failure is error.

## Stage (of a Job)

Fine-grained position within `dispatching` or `running`. Records *what the
Job is doing right now*. Composes with `status`; the pair `(status, stage)`
is the canonical display form.

`stage_updated_at` records when the current Stage was entered. Stage only
changes on a *boundary event* (see Job Event below) — never on a Heartbeat.

## Phase

A container-side Stage. The subset of Stage values that occur inside the
Container Executor: `cloning`, `archiving`, `hashing`, `uploading`,
`fetching_metadata`, `uploading_metadata`.

The other Stage values (`dispatching`, `container_accepted`, `finalizing`)
are orchestration Stages, not Phases. Phases ⊂ Stages.

## Outcome

The terminal record of a Job — written once when the Job reaches
`succeeded`, `failed`, or `cancelled`. Carries final status, start time,
finish time, and (for failures only) an error summary. Cancellations carry
no `error` value because they are user intent, not error. Parent of any
Artifact produced by the Job; cancelled Outcomes typically have zero
Artifacts.

Stored in the `runs` table for legacy reasons; the table name predates this
glossary and is misleading (an Outcome is *not* a per-attempt execution
record — those don't exist as rows). When `runs` is referenced in code,
read it as **Outcome**. Renaming the table is a deferred concern.

## Artifact

A persisted backup output in R2, linked to an Outcome. Rows in the
`artifacts` table.

## Container Executor

The single named Cloudflare Container instance that executes the backup
pipeline (clone, archive, hash, upload, fetch metadata, upload metadata).
Only one Job actively executes on the executor at a time.

## Dispatch

The act of the Queue consumer handing a Job to the Container Executor.
Distinct from execution: a Job is *dispatching* before the container has
accepted, and *running* afterwards.

## Job Event

A durable record of something that happened during a Job's lifecycle.
Always job-scoped — there are no Outcome- or attempt-scoped event tables.
The attempt an Event came from is recorded in `job_events.attempt`. Rows
in the `job_events` table. Append-only; the Job's `status`, `stage`, and
`last_event_at` are derived from or written alongside Job Events.

Events come in two kinds:

- **Boundary events** mark a Stage or Status transition (e.g.
  `phase_started`, `container_accepted`, `terminal_success`,
  `dispatch_failed`). They update `jobs.stage` and `stage_updated_at`.
- **Within-stage events** happen during a Stage without ending it. The
  only one is `heartbeat`, a periodic liveness pulse during a long Phase.
  It updates `last_event_at` but never `stage`.

This asymmetry is the reason `heartbeat` exists as its own event type —
without long Phases that can be silent for minutes, there'd be no need.

## Heartbeat

A periodic Job Event of type `heartbeat`, emitted by the container during
long-running Phases (clone, upload) to signal that work is still
progressing. The only within-stage Job Event — it refreshes
`last_event_at` but never changes the Job's Stage. Absence of *any* Job
Event (not heartbeats specifically) past a configured threshold makes a
Job *stale*.
