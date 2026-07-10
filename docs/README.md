# gitcask docs index

Orientation for humans and agents. Updated 2026-07-06.

## Where things stand

- **Phase 0 (June sprint) — complete.** Honest landing live on gitcask.com,
  green CI baseline, Cloudflare Artifacts beta access confirmed. Shipped in
  PR #20; PRD was issue #11.
- **Phase 1 — current.** Make the v0 engine honest and visible: verify one
  real backup end-to-end on live infra (#19), expose a latest/artifact read
  surface, add durable job-event observability. Tracked on GitHub Issues.
- **Phase 2 — next.** Cloudflare Artifacts integration spike (clone serving,
  GitHub import, scoped tokens).

## Where authority lives

1. Current code and verified runtime behavior.
2. GitHub Issues (the active task tracker — see `agents/issue-tracker.md`).
3. `brainstorms/2026-06-22-gitcask-positioning-roadmap-requirements.md` —
   the strategic roadmap and positioning source of truth.
4. `gitcask-state-review.md` — dated 2026-06-18 snapshot; see its correction
   notice.
5. `stranded-artifacts/README.md` — index of salvaged future-work source
   material. Source material, not executable plans.

## Directory map

- `plans/` — completed plan of record for Phase 0.
- `brainstorms/` — strategy documents.
- `stranded-artifacts/` — salvage notes from unmerged branches.
- `agents/` — tracker, triage-label, and domain conventions for agents.
