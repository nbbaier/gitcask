# Codebase Review (March 28, 2026)

## Scope

Reviewed Worker API routes, queue/scheduler/retention services, container backup service, CLI client, tests, and deployment/docs configuration.

## What I Checked

- Static quality gate: `bun x ultracite check`.
- Test execution: `bun run test`.
- Architecture and flow consistency across API → queue/container → callback → run/artifact persistence.
- Operational characteristics (observability, retries, cleanup behavior, scaling hotspots).
- Developer experience and docs correctness.

## Strengths

1. **Clear separation of responsibilities**
   - API routing, queue consumer, scheduled orchestration, retention, and container workload are cleanly split.
2. **Good lifecycle modeling for jobs**
   - Queue and callback paths consistently move jobs through `queued` → `running` → `completed/failed` with retry behavior.
3. **Reasonable backup metadata model**
   - Successful callbacks create run + artifact records and maintain a `latest.json` pointer in R2.
4. **Retention policy exists and covers both artifacts and run metadata**
   - There is explicit cleanup for old artifacts and stale run metadata.

## Findings

### 1) Test suite is currently misconfigured (High)

- `vitest.config.ts` points Cloudflare pool to `./wrangler.toml`, but the repository uses `wrangler.jsonc`.
- Running `bun run test` fails before tests start with: `Could not read file: /workspace/gitcask/wrangler.toml`.

**Impact**
- CI/local test execution is blocked by default.
- Regressions can slip through because tests are not runnable without manual config changes.

**Recommendation**
- Update `vitest.config.ts` to use `wrangler.jsonc` (`configPath: "./wrangler.jsonc"`).

### 2) README API example contains malformed header (Medium)

- The "Add a repo to back up" curl snippet has `Content-Type: application/` (truncated) instead of `application/json`.

**Impact**
- New users copying the command are likely to get avoidable request failures.

**Recommendation**
- Fix snippet to `-H "Content-Type: application/json"`.

### 3) Retention cleanup is O(all repos × all artifacts) each cron tick (Medium)

- `runRetentionCleanup` loads **all repos** and then **all artifacts per repo**, then iterates/deletes one by one.
- This runs on every scheduled event.

**Impact**
- As data grows, cron duration and D1/R2 operation volume can grow sharply.
- Potential timeout and cost pressure at scale.

**Recommendation**
- Move toward paginated/batched cleanup with explicit limits per tick.
- Consider per-repo watermarking and resumable cursor state.
- Prefer set-based D1 queries where possible before object-store deletions.

### 4) Manual trigger and queue path use different failure semantics (Low/Medium)

- Scheduled jobs route through queue with callback-driven retry behavior.
- Manual trigger dispatches in `waitUntil` and marks job failed directly on dispatch error (no re-enqueue retry path).

**Impact**
- Operational behavior differs by trigger source.
- Transient container dispatch failures may fail manual jobs more aggressively than scheduled jobs.

**Recommendation**
- Consider unifying manual trigger with queue enqueue path, or add equivalent retry behavior for manual dispatch failures.

### 5) Potential sensitive logging surface in webhook failure path (Low)

- On webhook send failure, logger prints `{ url, payload }`.

**Impact**
- If payloads later include sensitive fields, logs may leak more than necessary.

**Recommendation**
- Log minimal context (`event`, `repo.id`, status) and avoid full payload logging by default.

## Suggested Next Steps (Prioritized)

1. **Fix test config path immediately** so `bun run test` is green by default.
2. **Fix README curl header** to reduce onboarding friction.
3. **Add targeted tests** for:
   - Manual trigger dispatch failure behavior.
   - Retention edge cases (exact MAX_COUNT boundary, 7-day threshold behavior).
4. **Refactor retention** into bounded batches per cron tick.
5. **Harden logging policy** for external callback/webhook errors.

## Review Summary

The core architecture is solid and readable, with a sensible job/runs/artifacts model and practical backup workflow. The most pressing issue is test misconfiguration preventing routine verification. After that, the biggest medium-term risk is retention scaling behavior.
