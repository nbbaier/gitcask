# Gitcask v1 Implementation Plan

## Summary
Build a single-tenant backup service (`TypeScript + Bun`) that backs up explicit GitHub repos to Cloudflare R2 as immutable `tar.gz` mirror artifacts, with API management, scheduled jobs, and run history.

## Architecture

### Runtime Topology
- **Single Cloudflare Worker** with split routing:
  - Hono-based REST API (control plane)
  - Queue consumer (job dispatch)
  - Cron Trigger handler (scheduler)
- **Cloudflare Container** (Alpine + git):
  - Stateless HTTP service with a single `POST /backup` endpoint
  - Receives job payloads from the Worker, executes `git clone --mirror`, tars, and uploads to R2
  - Stays warm between jobs to avoid cold-start overhead
  - Worker passes GitHub PAT per-request (container holds no secrets)

### Storage & State
- **Cloudflare R2**: backup artifacts, metadata files, latest pointers
- **Cloudflare D1**: repo config, job/run metadata, retention bookkeeping (managed via Drizzle ORM + migrations)

### Auth
- **GitHub PAT**: stored as a Worker secret, passed to the container per-request
- **Admin API token**: single static `ADMIN_TOKEN` env var, checked via Bearer auth

## Backup Scope
- Full Git mirror (`--mirror`) of all refs and history
- GitHub metadata (`metadata.json`): repo description, topics, visibility, default branch, language — fetched via a lightweight GitHub API call
- Artifact integrity: SHA-256 computed by the container, verified on R2 upload via checksum header AND stored in D1 for later verification

## Scheduler & Queueing

### Scheduler
- Cloudflare **Cron Trigger** fires every 5 minutes
- Queries D1 for repos where `next_run_at <= now` and `enabled = true`
- Enqueues all due repos at once (no staggering)
- Advances `next_run_at = now + interval` on enqueue (prevents double-enqueue)

### Queue
- D1 is source of truth for schedules and run/job state
- Cloudflare Queues is dispatch transport from scheduler to Worker
- `max_concurrency = 4` on the queue consumer (platform-enforced concurrency cap)
- Queue messages include an idempotency key; Worker deduplicates against D1 (at-least-once delivery)

### Job Lifecycle
1. Scheduler or manual trigger creates a job row in D1, enqueues a queue message
2. Queue consumer picks up the message, dispatches to the container via HTTP
3. Container clones, tars, computes SHA-256, uploads to R2 with checksum header, returns result
4. Worker persists run metadata, artifact record, and updates `latest.json` in R2
5. On completion, Worker may adjust `next_run_at` if the interval changed mid-flight

### Retry Policy
- Initial attempt + 3 retries with exponential backoff
- On final failure: record in D1, fire webhook notification

## API Surface

All endpoints require `Authorization: Bearer <ADMIN_TOKEN>` except `/health`.

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/repos` | Validates repo exists and PAT has access via GitHub API before creating |
| `GET` | `/repos` | Returns all repos (no pagination). Supports `?enabled=true/false` filter |
| `PATCH` | `/repos/:id` | Update interval, enabled status, etc. |
| `DELETE` | `/repos/:id` | Hard deletes record, enqueues async job to clean up all R2 artifacts |
| `POST` | `/repos/:id/trigger` | Manual trigger with 5-minute cooldown. Deduplicates against queued/running jobs |
| `GET` | `/repos/:id/runs` | List runs for a repo |
| `GET` | `/runs/:id` | Get run details |
| `GET` | `/health` | Liveness + basic diagnostics (D1 reachable, container reachable) |

### Manual Trigger Deduplication
- Rejects if a job is currently queued or in-progress for the repo
- Rejects if a successful run completed within the last 5 minutes (cooldown)
- Cooldown is fixed at 5 minutes, not configurable in v1

## Data Contracts

### D1 Tables (Drizzle ORM)
- **repos**: `id`, `owner`, `name`, `interval_minutes`, `enabled`, `next_run_at`, `created_at`, `updated_at`
- **jobs**: `id`, `repo_id`, `trigger_source`, `idempotency_key`, `status`, `attempt`, lease/heartbeat fields, `created_at`, `updated_at`
- **runs**: `id`, `repo_id`, `job_id`, `status`, `started_at`, `finished_at`, `error`, `created_at`
- **artifacts**: `id`, `run_id`, `repo_id`, `object_key`, `sha256`, `size_bytes`, `created_at`

### Queue Message
```typescript
{
  job_id: string;
  repo_id: string;
  idempotency_key: string;
  attempt: number;
  trigger_source: "schedule" | "manual";
}
```

## Artifact Layout (R2)
- Immutable snapshot: `repos/{owner}/{repo}/snapshots/{timestamp}_{runId}.tar.gz`
- Metadata (separate object): `repos/{owner}/{repo}/snapshots/{timestamp}_{runId}_metadata.json`
- Latest pointer: `repos/{owner}/{repo}/latest.json`

No download API in v1 — artifacts accessed directly via R2 tooling (wrangler, S3-compatible clients).

## Retention Policy

### Hybrid: Minimum Time + Maximum Count
- **Minimum time floor**: 7 days — all snapshots within the last 7 days are kept regardless of count
- **Maximum count**: 30 — beyond the 7-day window, only the most recent 30 snapshots are retained
- **Run metadata TTL**: 180 days — cleanup job removes run records older than this

### Repo Deletion Cleanup
- `DELETE /repos/:id` hard-deletes the D1 record and enqueues an async cleanup job
- Cleanup job deletes all R2 objects under `repos/{owner}/{repo}/`

## Failure Handling

### Webhook Notifications
- On final job failure (all retries exhausted), fire a POST to a global `WEBHOOK_URL` env var
- Payload format: generic JSON
```json
{
  "event": "backup.failed",
  "repo": { "id": "...", "owner": "...", "name": "..." },
  "job_id": "...",
  "attempts": 4,
  "error": "...",
  "timestamp": "..."
}
```
- If `WEBHOOK_URL` is not configured, failures are only recorded in D1

## Container Service

### Image
- Base: Alpine Linux + git
- HTTP server: lightweight Bun or Node server
- Single endpoint: `POST /backup`
- Request: `{ owner, repo, pat, r2_credentials, object_key_prefix }`
- Response: `{ sha256, size_bytes, object_key, metadata }`

### Backup Pipeline (inside container)
1. `git clone --mirror` using provided PAT
2. `tar czf` the mirror directory
3. Compute SHA-256 of the tar.gz
4. Upload to R2 with SHA-256 checksum header
5. Fetch GitHub API metadata (description, topics, visibility, default branch, language)
6. Upload `metadata.json` to R2
7. Return result to Worker

## Local Development
- `wrangler dev` with local D1/R2/Queue emulation for the Worker
- Docker for the container service (local image build)
- No Docker Compose — wrangler handles CF service emulation

## Testing & Acceptance
1. Repo CRUD and admin-token auth enforcement
2. `POST /repos` validates GitHub repo accessibility before creating
3. Manual trigger deduplicates correctly (queued/running check + 5m cooldown)
4. Scheduler enqueues due repos from D1 at configured intervals
5. Queue consumer processes jobs idempotently under duplicate delivery
6. End-to-end backup writes artifact to R2 with verified checksum and size
7. Metadata.json written alongside each snapshot
8. Retry/backoff executes correctly and stops after max retries
9. Webhook fires on final failure
10. Concurrency cap of 4 is enforced via queue consumer config
11. Hybrid retention: keeps all snapshots within 7 days, caps at 30 beyond that
12. TTL cleanup removes run metadata older than 180 days
13. Repo deletion triggers async R2 artifact cleanup
14. `latest.json` updated after each successful backup

## Initial Deliverables
- Project scaffold: single Worker package + container service
- Wrangler config with D1, R2, Queue, and Cron Trigger bindings
- Drizzle ORM schema and migration set for core tables
- Hono router with all API endpoints
- Queue producer/consumer module and message contract
- Container service: Dockerfile (Alpine + git) and `/backup` endpoint
- R2 upload module with SHA-256 integrity verification
- Webhook notification module
- Local dev setup (wrangler dev + Docker for container)
- CI for unit + core integration tests
