# Stranded Artifact Index

This directory preserves useful work that is not part of the current execution
plan. Its contents have different levels of relevance: the top-level files are
salvage notes, while [`outdated/`](./outdated/) contains historical plans and
reviews. Neither group overrides current code or newer planning documents.

## Authority Order

When documents disagree, use this order:

1. Current code and verified runtime behavior.
2. The active
   [June sprint plan](../plans/2026-06-23-001-feat-june-sprint-honest-landing-plan.md).
3. The newer
   [positioning and roadmap](../brainstorms/2026-06-22-gitcask-positioning-roadmap-requirements.md).
4. The [repository state review](../gitcask-state-review.md).
5. The top-level salvage notes in this directory.
6. Material under [`outdated/`](./outdated/).

The [project brief](../gitcask-project-brief.md) supplies project context, but
its repository description is explicitly a prior understanding and does not
override the state review. Deployed behavior, Cloudflare resource state, and
Artifacts beta access remain unknown until verified directly.

## Salvage Notes

These notes distill unmerged branch work, but they are not equally current.

| Note | Current role | How to use it |
| --- | --- | --- |
| [Backup observability](./backup-observability.md) | **Phase 1 planning input** | Preserve the Jobs-versus-Outcomes model, append-only events, heartbeat/staleness semantics, redaction rules, and the trigger for reconsidering Cloudflare Workflows. Current jobs already expose durable stage fields, so a fresh plan must build on those rather than assume no progress data exists. |
| [Native Git client](./native-git-client.md) | **Parked alternative** | Keep as design research for a native smart-HTTP or fallback engine. The newer roadmap selects Cloudflare Artifacts as the intended v1 clone-serving engine, so this note does not gate the Phase 1 read surface and should not define v1 unless that decision changes. |
| [Dynamic Workers opportunities](./dynamic-workers-opportunities.md) | **Deferred ideas bank** | Revisit success webhooks, verification, enrichment, and diff summaries after the core roadmap. Dynamic Workers are not an accepted mechanism, and several original ideas are already implemented without them. |

The source branches and salvage decisions are documented in the
[repository state review](../gitcask-state-review.md).

## Historical Archive

The archive is not a single bucket of useless material. Its execution
instructions are obsolete, but some files preserve open findings or design
rationale that should inform a fresh plan.

### Original Blueprint

[`outdated/PLAN.md`](./outdated/PLAN.md) is the original container-and-R2 v1
blueprint. Much of its Worker, D1, Queue, container, mirroring, retention, and
callback topology exists in code, although the live backup path remains
unverified. Its product identity and v1 destination are superseded by the newer
edge-native mirror positioning and Artifacts-backed `git clone` roadmap.

Use it for architecture provenance and the v0 fallback contract, not for
current scope, product claims, or execution order.

### Numbered Plans

The TODO states in [`outdated/plans/`](./outdated/plans/) were never updated as
the work evolved. This assessment reflects current code and newer docs:

| Plan | Current assessment | Treatment |
| --- | --- | --- |
| [001 verification baseline](./outdated/plans/001-verification-baseline.md) | Superseded and unexecuted | The active June plan U1-U3 replaces it. |
| [002 lifecycle test backfill](./outdated/plans/002-lifecycle-test-backfill.md) | Still relevant | Deadline-sweep and cancel-route coverage remain absent; use as source material for future reliability work. |
| [003 auth-gate debug endpoints](./outdated/plans/003-auth-gate-debug-endpoints.md) | Still relevant and promoted | The active June plan makes this an explicit U6 go-live decision. Follow the newer plan. |
| [004 rescue stuck queued jobs](./outdated/plans/004-rescue-stuck-queued-jobs.md) | Still relevant | Queued jobs are not covered by the current deadline sweep; reconcile with the observability/staleness model before planning. |
| [005 active-job atomicity](./outdated/plans/005-active-job-atomicity.md) | Still relevant | The database does not enforce one active job per repo and several transitions remain vulnerable to check-then-act races. Revalidate and rewrite before implementation. |
| [006 bound run queries](./outdated/plans/006-bound-run-queries.md) | Still relevant, lower priority | Unbounded and in-memory run queries remain; incorporate bounded/newest-first contracts into a fresh read-surface plan. |
| [007 repo hygiene](./outdated/plans/007-repo-hygiene.md) | Superseded as a bundle | Some small hygiene findings survive, but its deployment and landing structure conflicts with the active June plan. Split and revalidate any desired task. |
| [008 input/auth hardening](./outdated/plans/008-input-auth-hardening.md) | Still relevant, lower priority | Timing-safe token comparison and tighter input bounds remain valid hardening leads, but are not current sprint scope. |
| [009 restore/read API spike](./outdated/plans/009-restore-read-api-spike.md) | Mixed | Its latest/artifact read surface remains a Phase 1 input. Rewrite its tarball-centered restore direction around the newer Artifacts-backed clone goal. |

The old global execution order is no longer valid. If the lifecycle reliability
work is accepted later, the internal dependency `002 -> 004 -> 005` is still a
useful sequencing constraint. Plans 005, 006, and 008 also overlap the repo
routes and should be coordinated if revived.

### Historical Reviews

The files under [`outdated/review/`](./outdated/review/) are evidence of what
was examined, not a current defect list.

| Review | Current assessment | Durable value |
| --- | --- | --- |
| [Architecture deepening](./outdated/review/ARCHITECTURE_DEEPENING.md) | JobLifecycle and BackupDispatcher landed. Aggregate stores, ArtifactStore, and a backup decision service were deliberately deferred. The deadline-sweep and cancel test gaps remain open. | Preserve the ownership boundaries, reasons for rejecting generic stores, and explicit triggers for reopening deferred abstractions. |
| [Change detection](./outdated/review/CHANGE_DETECTION_REVIEW.md) | Its blockers and concrete code defects are resolved. | Preserve the fail-open policy discussion for unreachable GitHub state and document that manual triggers intentionally force a backup. |
| [Codebase review](./outdated/review/CODEBASE_REVIEW.md) | Its listed defects are resolved or superseded. | Historical proof of fixes; do not promote its old recommendations without finding a current regression. |

## Relationship To The Current Roadmap

1. **Current June sprint:** follow the active plan. It supersedes archived plan
   001 and owns the debug-endpoint decision from plan 003.
2. **Phase 1, make the v0 engine honest and visible:** verify one backup
   end-to-end, create a fresh bounded read-surface plan from plan 009 Part A,
   and use the backup-observability note as planning input. Reliability work
   from plans 002, 004, and 005 can be scoped alongside that phase when its
   acceptance criteria are written.
3. **Phase 2, Artifacts integration:** test Cloudflare Artifacts as the storage
   and clone-serving engine. The native Git note remains a parked alternative,
   not the default path.
4. **Later work:** query scaling, general hardening, post-backup enrichment,
   and Dynamic Workers ideas need explicit promotion into a new plan.

## Guardrails

- Do not execute an archived plan verbatim or infer priority from an old TODO.
- Do not merge the source branches wholesale.
- Do not revive a finding that current code or a newer document has resolved.
- Do not let native Git storage decisions block the Phase 1 read surface; the
  current roadmap gives Artifacts precedence for v1.
- Turn surviving ideas into fresh plans with current file paths, tests,
  acceptance criteria, and deployment assumptions.
