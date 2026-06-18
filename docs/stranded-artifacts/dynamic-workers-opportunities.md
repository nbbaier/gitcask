# Dynamic Workers Opportunities Artifact

Source branch: `explore/dynamic-worker`

Status: salvage note. Some original ideas are already covered by `main`, so
this file keeps only the direction worth reconsidering.

## Framing

The branch framed Cloudflare Dynamic Workers as lightweight helpers around the
heavy container backup pipeline. Containers do Git and filesystem work;
Dynamic Workers, or whatever mechanism replaces them, can handle narrow tasks
such as validation, verification, notification, enrichment, and summaries.

Before implementation, re-check whether Dynamic Workers are still the right
Cloudflare primitive. The ideas below do not require that mechanism.

## Already Covered On Main

- Repo access validation exists in `src/lib/github.ts` and `POST /repos`.
- Scheduled change detection exists in `src/services/change-detection.ts` and
  `src/services/scheduler.ts`, based on GitHub `pushed_at`.
- Repo deletion does R2 prefix cleanup in `src/routes/repos.ts`.

Do not reimplement those from the old branch without a new reason.

## Still Useful Ideas

### Successful Backup Webhooks

Current code only has failure webhook behavior. Success notifications would
make silence less ambiguous for demos and external monitoring.

Candidate payload:

```json
{
  "event": "backup.completed",
  "repo": { "owner": "org", "name": "repo" },
  "artifact": { "sha256": "...", "size_bytes": 12345678 },
  "duration_ms": 8432,
  "timestamp": "2026-03-26T12:00:00Z"
}
```

Action: consider a non-blocking success webhook in the callback success path,
with retries outside the critical request if possible.

### Artifact Integrity Verification

Current code computes SHA-256 during upload, stores it in D1, and sends a R2
checksum header. It does not periodically re-read artifacts to verify they are
still present and match expected hashes.

Action: add a bounded verification job after artifact listing/latest endpoints
exist. It should sample artifacts, stream from R2, compare SHA-256, and record
or alert on mismatches.

### Metadata Enrichment

Current metadata is intentionally basic: description, topics, visibility,
default branch, language, and fetched timestamp.

Potential enrichment:

- language breakdown
- license
- branch protection summary
- vulnerability alert status
- collaborator/team counts where permitted

Action: defer until the demo needs richer proof or compliance framing. Keep it
as post-backup enrichment so the main backup can complete without waiting on
extra GitHub API calls.

### Backup Diff Summary

A run currently tells you that a backup happened, not what changed.

Potential summary:

- added refs
- removed refs
- changed refs
- total refs

Action: consider storing a ref snapshot or summary after the artifact
visibility work lands. This could make a "queryable backup" claim more honest.

## Implementation Guardrails

- Keep helper work bounded per cron/callback tick.
- Do not block terminal callback success on enrichment or notification.
- Treat GitHub API limits as a first-class constraint.
- Never pass GitHub PATs, R2 credentials, callback tokens, or secret-bearing
  clone URLs into logs or persisted event details.
- Prefer simple Worker code first; introduce Dynamic Workers only if they
  materially improve isolation, binding control, or operational clarity.

