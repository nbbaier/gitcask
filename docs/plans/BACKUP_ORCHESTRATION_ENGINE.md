# Backup Orchestration Engine Decision Memo
## Status
**Deferred — not scheduled.** This memo captures analysis from the backup observability review (see [BACKUP_OBSERVABILITY_PLAN.md](./BACKUP_OBSERVABILITY_PLAN.md)). It should be revisited only after Phase 1 observability work is shipped and operated long enough to expose whether the custom orchestration engine (Queue consumer + D1 transitions + deadline sweep + callback bridge) is worth replacing.

The original incident motivating this work was an observability gap, not an orchestration failure. Observability is being addressed independently. The question this memo preserves is a separate one: **should the custom workflow engine be replaced with Cloudflare Workflows?**
## Question
Is the maintenance burden of the current bespoke orchestration (custom retry, deadline sweep, callback handling, queue dispatch, in-memory state) high enough to justify migrating to Cloudflare Workflows as the durable orchestrator?

This is a forward-looking question. Phase 1 observability work intentionally keeps the existing engine.
## Options Previously Considered
### Option A: Keep the Queue-based engine
Continue maintaining the current Queue consumer, D1 lifecycle transitions, custom retry/deadline logic, and callback handling. Observability improvements from Phase 1 already land here.

**Advantages**

- No architecture change beyond Phase 1.
  
- Preserves all existing control flow, deployment bindings, and rollback surface.
  

**Disadvantages**

- Continues to maintain a custom workflow engine in D1, Queue code, callbacks, deadlines, and retry transitions.
  
- Durable waiting for external results remains hand-built.
  
- Future cancellation, recovery, and operator tooling continue to require bespoke lifecycle work.
  
### Option B: Workflows orchestrator with the existing container executor
Create one Workflow instance per backup job. The Workflow owns durable orchestration, retries, waits, and terminal flow; the container continues to execute the backup pipeline. D1 stores job summaries and event history for the API/CLI.

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

- Replaces custom cross-module orchestration with durable Workflow steps and event waits.
  
- Allows step-level retries/timeouts while preserving app-facing D1 history.
  
- Supports incremental adoption: the container need not be rewritten first.
  
- Uses Cloudflare Workflow observability alongside structured application events.
  

**Disadvantages**

- Requires a new Workflow binding, callback/event bridge, schema evolution, and migration of trigger paths.
  
- Requires care to make D1/R2 side effects idempotent under Workflow retries.
  
- Does not resume an interrupted clone or single upload within the container.
  
### Option C: Fully decomposed Workflow and container pipeline
Move clone, archive, hashing, upload, and metadata into separately recoverable units, backed by persisted intermediate state or workspaces. The Workflow resumes after individual completed units rather than replaying the entire container pipeline.

**Advantages**

- Strongest recovery boundaries for large repositories or expensive transfers.
  
- Fine-grained duration, retry, and operational accounting.
  

**Disadvantages**

- Significantly changes artifact ownership, intermediate cleanup, security, and storage requirements.
  
- Adds complexity before the current backup volume demonstrates a need for partial-operation resume.
  
## Option Comparison
| Criterion | Option A: Keep Queue | Option B: Workflows + Container | Option C: Decomposed Pipeline |
| --- | --- | --- | --- |
| Durable retries/timeouts/waiting | Custom | Native orchestration | Native orchestration |
| Resume between orchestration steps | Limited | Good | Excellent |
| Resume within clone/upload | No  | No  | Potentially |
| Migration complexity | None (already shipped) | Moderate | High |
| Single-container admission clarity | Must add explicitly | Natural Workflow step | Must redesign execution pool |
| Cloudflare operator visibility | Logs only plus custom state | Workflow steps plus logs/events | Workflow steps plus logs/events |
## Tentative Direction (if revisited)
If a decision were forced today, **Option B** with the existing container executor would be the recommendation. Option C is deferred unless large backup transfers routinely fail after substantial elapsed time, or replaying a whole container run becomes materially expensive.
## What Should Trigger Revisiting
Open this memo again if any of the following become true after Phase 1 ships:

- The custom retry/deadline/callback code becomes a recurring source of bugs or operator confusion.
  
- A product need emerges that the current engine cannot serve cleanly (cancellation, pause/resume, multi-step recovery, fan-out).
  
- Backup durations grow large enough that replaying a whole container run on retry becomes materially expensive.
  
- Operator load on diagnosing stuck jobs remains high _even after_ Phase 1 event history and heartbeat work has landed.
  

If none of these surface, the engine is fine as-is.
## Sketch of a Future Migration Sequence
Preserved here as a starting point if the decision is ever made to migrate.

1. **Manual jobs through Workflows.** Configure a `BackupWorkflow` binding. Create workflow instances for manual triggers with deterministic job IDs. Use Workflow steps for admission, dispatch, terminal event wait, finalization, and failure notification. Continue using the existing container protocol plus event reporting from Phase 1.
  
2. **Scheduled jobs through Workflows.** Have cron/change-detection create Workflow-backed jobs directly. Stop using the Queue for primary backup execution.
  
3. **Simplify retired machinery.** Remove obsolete Queue-consumer backup dispatch and custom orchestration retry/deadline logic after production evidence confirms replacement behavior. Preserve migrations and read compatibility for historical job/run rows.
  
## Open Design Questions for That Future Migration
- Mechanism for single-active-container admission within a Workflow step.
  
- Idempotency strategy for R2 artifact write and latest-pointer update under Workflow step retries.
  
- Whether to bridge container terminal callbacks through the Worker into a Workflow event, or expose Workflow event delivery directly to the container.
  
- Workflow instance ID derivation from application job IDs.
  
- Retention policy for Workflow instance history versus D1 event history.
  
## Cloudflare References
- [Cloudflare Workflows overview](https://developers.cloudflare.com/workflows/)
  
- [Sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/)
  
- [Workflows Workers API and event waits](https://developers.cloudflare.com/workflows/build/workers-api/)
  
- [Rules of Workflows and idempotent side effects](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
  
- [Workflow metrics and analytics](https://developers.cloudflare.com/workflows/observability/metrics-analytics/)
