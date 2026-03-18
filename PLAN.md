# Gitcask v1 Implementation Plan

## Summary
Build a single-tenant backup service (`TypeScript + Bun`) that backs up explicit GitHub repos to Cloudflare R2 as immutable `tar.gz` mirror artifacts, with API management, scheduled jobs, and run history.

## Key Design
- Runtime topology:
  - `api` service (REST control plane)
  - `worker` service (scheduler + backup execution)
- Storage/state:
  - Cloudflare R2 for backup artifacts
  - Cloudflare D1 for repo config, job/run metadata, retention bookkeeping
- Auth:
  - Global GitHub PAT for repo access
  - Static admin token for API auth
- Backup scope:
  - Full Git mirror (`--mirror`) of refs/history
  - Artifact integrity: SHA-256 + size verification
- Reliability defaults:
  - Per-repo interval scheduling (`min=15m`, default `24h`)
  - Global concurrency cap `4`
  - Retry policy: initial attempt + 3 retries with backoff
  - Artifact retention: keep last 30 per repo
  - Run metadata retention: 180 days

## Scheduler and Queueing
- Use a hybrid model:
  - D1 is source of truth for schedules and run/job state
  - Cloudflare Queues is dispatch transport from scheduler to workers
- Flow:
  - Scheduler selects due repos from D1 and enqueues queue messages
  - Workers consume queue messages and execute backups
  - Workers persist state transitions and run metadata to D1
- Idempotency:
  - Queue messages include an idempotency key
  - Worker deduplicates against D1 because Queue delivery is at-least-once

## API Surface
- `POST /repos`
- `GET /repos`
- `PATCH /repos/:id`
- `DELETE /repos/:id`
- `POST /repos/:id/trigger` (deduplicate if already queued/running)
- `GET /repos/:id/runs`
- `GET /runs/:id`
- `GET /health`
- `GET /ready`

## Data Contracts
- `repos`: `id`, `owner`, `name`, `interval_minutes`, `enabled`, `next_run_at`, timestamps
- `jobs`: `id`, `repo_id`, `trigger_source`, `idempotency_key`, `status`, `attempt`, lease/heartbeat fields, timestamps
- `runs`: `id`, `repo_id`, `job_id`, `status`, `started_at`, `finished_at`, `error`, timestamps
- `artifacts`: `id`, `run_id`, `object_key`, `sha256`, `size_bytes`, `created_at`
- Queue message: `job_id`, `repo_id`, `idempotency_key`, `attempt`, `trigger_source`

## Artifact Layout
- Immutable snapshot key:
  - `repos/{owner}/{repo}/snapshots/{timestamp}_{runId}.tar.gz`
- Latest pointer:
  - `repos/{owner}/{repo}/latest.json`

## Testing and Acceptance
1. Repo CRUD and admin-token auth enforcement.
2. Manual trigger deduplicates correctly.
3. Scheduler enqueues due repos from D1 at configured intervals.
4. Queue consumer processes jobs idempotently under duplicate delivery.
5. End-to-end backup writes artifact to R2 with verified checksum and size.
6. Retry/backoff executes correctly and stops after max retries.
7. Concurrency cap of 4 is enforced.
8. Retention deletes artifacts beyond last 30.
9. TTL cleanup removes run metadata older than 180 days.

## Initial Deliverables
- Project scaffold with `api` and `worker` packages.
- D1 schema and migration set for core tables.
- Queue producer/consumer module and message contract.
- R2 upload module with integrity verification.
- Local dev setup (compose) and baseline Cloudflare deployment config.
- CI for unit + core integration tests.
