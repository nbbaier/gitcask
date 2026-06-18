# Stranded Artifact Index

This directory preserves the branch work that is worth carrying into the next
phase without merging old branch states into `main`.

The source branches were reviewed in `gitcask-state-review.md`. Treat these
notes as planning inputs, not accepted implementation plans.

## Action Order

1. **Backup visibility and restore direction**
   - Read: [native-git-client.md](./native-git-client.md)
   - Pair with: [plans/009-restore-read-api-spike.md](../../plans/009-restore-read-api-spike.md)
   - Action: decide whether `tar.gz` remains only the download artifact or also
     the canonical storage format.
   - Use when planning: latest/artifact read endpoints, download URLs, restore
     UX, or any future replacement for the container backup path.

2. **Job observability and stuck-job diagnosis**
   - Read: [backup-observability.md](./backup-observability.md)
   - Pair with: [plans/003-auth-gate-debug-endpoints.md](../../plans/003-auth-gate-debug-endpoints.md)
     and [plans/004-rescue-stuck-queued-jobs.md](../../plans/004-rescue-stuck-queued-jobs.md)
   - Action: turn the event model into a concrete schema/API plan only after
     the verification baseline is green.
   - Use when planning: live demo debugging, job history, heartbeat/staleness,
     cancellation semantics, or callback idempotency.

3. **Post-backup proof and enrichment**
   - Read: [dynamic-workers-opportunities.md](./dynamic-workers-opportunities.md)
   - Action: harvest the verification, enrichment, success webhook, and diff
     summary ideas. Re-check whether Dynamic Workers are still the desired
     mechanism before implementation.
   - Use when planning: artifact verification, richer metadata, success
     notifications, audit summaries, or cleanup beyond current retention.

## What Not To Do

- Do not merge the source branches wholesale. They are old and conflict with
  current `main`.
- Do not treat these notes as current product claims.
- Do not implement native-git storage and backup visibility in the same PR
  unless the storage format decision has already been made.
- Do not add observability schema changes before the lint/typecheck/test
  baseline is fixed.

