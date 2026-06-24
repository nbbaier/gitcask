# Plan 003: Auth-gate the worker debug endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- src/routes/health.ts src/index.ts test/api.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md (for the verification gates)
- **Category**: security
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

The health router is mounted on the public (unauthenticated) app, and it contains two **debug** endpoints alongside the legitimate public health check. `POST /health/debug/connectivity` lets any unauthenticated caller make the backup container fire an HTTP request that carries the `ADMIN_TOKEN` bearer token (the target host is fixed to `WORKER_URL`, so the token can't be exfiltrated to an attacker host, but internal API responses, job IDs, and error bodies are relayed back to the anonymous caller). `GET /health/debug/container-jobs` exposes recent job IDs, statuses, and error messages (which can include sanitized git stderr) to anyone. The fix is one middleware line plus tests.

## Current state

- `src/index.ts:15-16` — health routes are mounted on the public app, before the authenticated sub-apps:

```ts
// src/index.ts:15-16
// Public endpoint
app.route("/health", healthRoutes);
```

- `src/routes/health.ts` — a Hono sub-app with three routes:
  - `GET /` (lines 6–32) — the real health check (D1 ping + container ping). Must STAY public; the README documents `curl http://localhost:8787/health` with no auth.
  - `POST /debug/connectivity` (lines 35–60) — forwards `{ target_url: WORKER_URL + "/internal/jobs/<id>/progress", token: c.env.ADMIN_TOKEN }` to the container's `/debug/connectivity` and returns the container's result (which includes the fetched response body) to the caller.
  - `GET /debug/container-jobs` (lines 63–78) — proxies the container's in-memory recent-jobs list.
- `src/lib/auth.ts` — `adminAuth(c, next)` middleware: requires `Authorization: Bearer <ADMIN_TOKEN>`, returns 401 JSON otherwise. This is the auth convention used for all non-public routes (see `src/index.ts:498-510`).
- `test/api.test.ts` — has a `makeRequest(path, options, token="test-admin-token")` helper and an `Auth` describe block asserting 401s (lines 71–89). The Miniflare test binding sets `ADMIN_TOKEN: "test-admin-token"` (see `vitest.config.ts`).
- Note: the container-side debug endpoints (`container/server.ts:54-100`) accept an arbitrary `target_url` + `token` with no auth. In production the container is reachable only through the Durable Object binding, and locally only on localhost:8788; hardening them is explicitly OUT of scope here (see Maintenance notes).

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Install   | `bun install`       | exit 0              |
| Typecheck | `bun run typecheck` | exit 0              |
| Tests     | `bun run test`      | all pass            |
| Lint      | `bun run check`     | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `src/routes/health.ts`
- `test/api.test.ts` (add tests)

**Out of scope** (do NOT touch):
- `container/server.ts` — the container's own debug endpoints are a separate decision (DO-binding-only in prod); leave them.
- `src/index.ts` — the mount point stays; gating happens inside the health router so `GET /health` remains public.
- `src/lib/auth.ts` — reuse it as-is.

## Git workflow

- Branch: `security/003-debug-endpoint-auth`
- Commit style: conventional commits, e.g. `fix: require admin auth on health debug endpoints`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Apply adminAuth to the debug sub-paths

In `src/routes/health.ts`, import the middleware and register it for the debug prefix BEFORE the debug route definitions (Hono middleware must be registered before the routes it protects):

```ts
import { adminAuth } from "../lib/auth.ts";
// after `const app = new Hono<{ Bindings: Env }>();` and the GET "/" route is fine,
// but it MUST appear above the two /debug route definitions:
app.use("/debug/*", adminAuth);
```

`GET /` is unaffected because the middleware pattern only matches `/debug/*`.

**Verify**: `bun run typecheck` → exit 0.

### Step 2: Add tests

In `test/api.test.ts`, add a `describe("health debug endpoints", ...)` inside the top-level `describe("Gitcask API")`:

1. **GET /health stays public** — may already be covered by the existing `GET /health` test (keep that passing; no duplicate needed).
2. **401 without token**: `new Request("http://localhost/health/debug/container-jobs")` (no auth header) → expect 401.
3. **401 without token (connectivity)**: POST `http://localhost/health/debug/connectivity` with JSON body `{}` and no auth header → expect 401.
4. **authed request passes the gate**: `makeRequest("/health/debug/container-jobs")` → expect status **not** 401 (in Miniflare the container binding may be unreachable, so accept 200 or 500 — assert `res.status !== 401`).

**Verify**: `bunx vitest run test/api.test.ts` → all pass, including 3 new tests.

### Step 3: Full gate

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0.

## Test plan

See Step 2. Pattern: the existing `Auth` describe block in `test/api.test.ts:71-89`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n 'app.use("/debug/\*", adminAuth)' src/routes/health.ts` returns a match positioned above both debug route definitions
- [ ] `bun run test` exits 0, including the 3 new tests
- [ ] `bun run typecheck` and `bun run check` exit 0
- [ ] `git status` shows only the two in-scope files modified
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `src/routes/health.ts` no longer matches the three-route structure described above.
- The existing public `GET /health` test starts failing after Step 1 (would mean the middleware pattern is over-matching).
- You find additional unauthenticated routes beyond `/health/*` and `GET /` (landing page) mounted on the public app — report them, don't fix them here.

## Maintenance notes

- Anyone adding a new route under `/health/debug/` gets auth for free now; new debug routes elsewhere must be mounted behind `adminAuth` deliberately.
- Deferred follow-up (deliberately out of scope): the container's `/debug/connectivity` (`container/server.ts:59-100`) will POST a caller-supplied token to a caller-supplied URL. It is unreachable except via the DO binding or localhost, but if the container ever gets its own ingress, remove or gate that endpoint first.
- Plan 008 hardens the auth middleware itself (timing-safe comparison); no interaction with this change.
