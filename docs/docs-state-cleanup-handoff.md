# Docs State Cleanup Handoff

> **Superseded.** The cleanup requested in this handoff was completed in PR #25.
> See [`docs/README.md`](../README.md) for the current docs index and phase
> status. The original content below is retained only for audit history.

---

Date: 2026-07-06

## Purpose

This handoff is for an agent cleaning up gitcask's documentation state after the June sprint and follow-up landing cleanup. The implementation has moved forward, but several planning and status documents still describe the pre-completion state.

## Suggested Skills

- `github:github` — inspect and update GitHub issue state, especially #11, #19, and #6.
- `triage` — decide whether issues need `ready-for-agent`, `needs-triage`, `needs-info`, or closure.
- `domain-modeling` or `grill-with-docs` — use only if changing roadmap/domain language, especially around Phase 1, Artifacts, or mirror/backup terminology.

## Current Source-Of-Truth Split

- GitHub Issues are the active task tracker.
- Filesystem docs are strategy, archive, and source material.
- `docs/brainstorms/2026-06-22-gitcask-positioning-roadmap-requirements.md` remains the strategic roadmap.
- `docs/stranded-artifacts/README.md` is the best index for future-work source material.
- `docs/agents/issue-tracker.md` says issues and PRDs live in GitHub Issues and should be managed with `gh`.

## Current GitHub State

- [#11 PRD: gitcask June sprint — honest landing live + green baseline](https://github.com/nbbaier/gitcask/issues/11) is still open. Its latest maintainer comment says U1-U7 are complete, the landing is live, CI is green, Artifacts access is confirmed, and U8 is deferred. It should probably be closed or clearly marked complete.
- [#19 U8 (STRETCH): Verify one backup end-to-end on live infra](https://github.com/nbbaier/gitcask/issues/19) is still open and labeled `ready-for-agent`. Its comments say it rolled into Phase 1 after the June 29 timebox expired. It likely needs to be rewritten or confirmed as the first Phase 1 issue.
- [#6 Trigger backup through webhook](https://github.com/nbbaier/gitcask/issues/6) is still open but thinly specified. It likely needs triage or a rewrite before an agent picks it up.
- Closed issues #12-#18 are the completed June sprint execution units.

## Implementation State To Reflect

The repo is on clean `main`, synced with `origin/main`. Recent commits after PR #20 cleaned up the landing implementation.

Docs should reflect that:

- The landing page is extracted into `src/landing/index.html`, `src/landing/index.css`, and `src/landing/favicon.svg`.
- `src/index.ts` serves the landing HTML, CSS, and favicon via text-module imports.
- `package.json` has `typecheck: tsc --noEmit`.
- `.github/workflows/ci.yml` runs `bun run check`, `bun run typecheck`, and `bun run test`.
- `wrangler.jsonc` has a production `gitcask.com` custom-domain route and `WORKER_URL: https://gitcask.com`.
- The June sprint appears complete through PR #20 plus later landing cleanup commits.

## Docs Needing Cleanup

- `docs/gitcask-state-review.md` is stale in multiple places. It still says there is no CI, no typecheck script, a lint failure, an inline landing page, and unknown deployment status.
- `README.md` is partly stale. It still mentions a known `test/env.d.ts` lint issue and describes `bun run check` as lint plus typecheck, even though typecheck is now its own script.
- `docs/plans/2026-06-23-001-feat-june-sprint-honest-landing-plan.md` still reads as an active plan. Mark it completed, archived, or add a completion note.
- `docs/stranded-artifacts/README.md` still says "current June sprint" in its authority and roadmap language. Update it so Phase 0/June is complete and Phase 1 is the current planning horizon.
- Consider adding or updating a concise docs index that says: Phase 0 complete; Phase 1 next includes live v0 backup verification, read/latest/artifact surface, and job-event observability; Phase 2 is the Cloudflare Artifacts spike.

## Recommended Cleanup Outcome

1. Stop docs from contradicting current code.
2. Clearly mark the June sprint / Phase 0 as complete.
3. Promote Phase 1 as the current planning horizon.
4. Keep stranded artifacts as source material, not executable plans.
5. Align docs with the recommended GitHub issue actions: close or update #11, rewrite or confirm #19 as Phase 1, and triage #6.
