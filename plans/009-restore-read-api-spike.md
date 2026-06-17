# Plan 009: Surface backups — latest/artifact read endpoints now, restore/download design spike

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- src/routes/ src/db/schema.ts cli/ test/api.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M (Part A: concrete endpoints, S; Part B: design memo, S–M)
- **Risk**: LOW (Part A is read-only surface; Part B writes no code)
- **Depends on**: plans/001-verification-baseline.md
- **Category**: direction
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

gitcask backs repos up completely but gives users **no way to see or retrieve what it stored**. The original plan (`PLAN.md`, "Artifact Layout") explicitly deferred a download API out of v1; v1 has shipped, and the deferral is now the product's biggest asymmetry. Two pieces of the answer are already computed and persisted but unexposed: every artifact's SHA-256 + object key live in D1 (`artifacts` table), and a `latest.json` pointer is written to R2 on every successful backup (`src/routes/callback.ts:108-119`) — yet no route or CLI command reads either. Part A of this plan exposes them (cheap, concrete). Part B produces a design memo for actual download/restore — a decision document for the maintainer, NOT an implementation.

## Current state

- `src/db/schema.ts:67-79` — `artifacts` table: `id, run_id, repo_id, object_key, sha256, size_bytes, created_at`.
- `src/routes/callback.ts:108-119` — on success, writes to R2 key `repos/{owner}/{name}/latest.json`:

```ts
JSON.stringify({
  run_id: result.runId,
  object_key: payload.object_key,
  metadata_key: payload.metadata_key,
  sha256: payload.sha256,
  size_bytes: payload.size_bytes,
  timestamp: result.finishedAt,
})
```

- `src/routes/runs.ts` — `GET /runs/:id` already returns a run **with its artifacts array** (the only existing artifact exposure; reachable only if you already know a run ID).
- `src/routes/repos.ts` — Hono sub-app mounted (with adminAuth) at `/repos` (`src/index.ts:504-510`); has `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id`, `POST /:id/trigger`, `GET /:id/runs`. New repo-scoped routes belong here. Pattern for a repo-scoped route — load repo, 404 if missing (see `GET /:id/runs`, lines 354–373).
- R2 binding: `c.env.BUCKET` (type `R2Bucket`); read pattern: `const obj = await c.env.BUCKET.get(key); if (!obj) ...; const data = await obj.json();`
- CLI: citty-based. `cli/index.ts` registers subcommands from `cli/commands/`; `cli/client.ts` is a small fetch wrapper reading `GITCASK_URL`/`GITCASK_TOKEN` from env/config (`cli/config.ts`); `cli/commands/runs.ts` (40 lines) is the simplest exemplar of a list command with `cli/format.ts` table output.
- Tests: `test/api.test.ts` patterns as in other plans. Miniflare emulates the `BUCKET` R2 binding — tests can `await env.BUCKET.put("repos/o/n/latest.json", JSON.stringify({...}))` directly.
- Container flow (context for Part B): the container clones with a per-request PAT, tars, uploads via S3 API, and calls back; the Worker never streams artifact bytes itself. Workers have CPU/memory limits that make proxying multi-GB tarballs through the Worker a bad idea; R2 presigned URLs (S3 API) or `BUCKET.get` streaming are the design space.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Install   | `bun install`                      | exit 0              |
| Typecheck | `bun run typecheck`                | exit 0              |
| Tests     | `bun run test`                     | all pass            |
| Lint      | `bun run check`                    | exit 0              |
| CLI smoke | `bun run cli -- --help`            | command list prints |

## Scope

**In scope** (the only files you should modify/create):
- `src/routes/repos.ts` (two new GET routes)
- `cli/commands/repos.ts` or a new `cli/commands/artifacts.ts` (one new CLI command)
- `cli/index.ts` (register the command, if a new file)
- `test/api.test.ts`
- `plans/009-design-restore.md` (create — the Part B memo)

**Out of scope** (do NOT touch):
- Any download/streaming/presigned-URL implementation — Part B designs it; nobody builds it under this plan.
- `container/server.ts`, `src/routes/callback.ts`, retention.
- Response shapes of existing endpoints.

## Git workflow

- Branch: `feat/009-backup-visibility`
- Commit style: conventional commits, e.g. `feat: expose latest backup pointer and artifact listing`
- Do NOT push or open a PR unless the operator instructed it.

## Steps — Part A (concrete)

### Step A1: `GET /repos/:id/latest`

In `src/routes/repos.ts`, add a route following the `GET /:id/runs` pattern: load repo → 404 `{ error: "Repo not found" }` if missing → `BUCKET.get(`repos/${repo.owner}/${repo.name}/latest.json`)` → if null, 404 `{ error: "No completed backup yet" }` → else return the parsed JSON body as-is (200).

**Verify**: `bun run typecheck` → exit 0.

### Step A2: `GET /repos/:id/artifacts`

Add a route returning the repo's artifacts from D1, newest first, bounded:

```ts
const results = await db
  .select()
  .from(schema.artifacts)
  .where(eq(schema.artifacts.repo_id, id))
  .orderBy(desc(schema.artifacts.created_at))
  .limit(50);
```

(404 on unknown repo first, same as A1. Import `desc` if not present.)

**Verify**: `bun run typecheck` → exit 0.

### Step A3: CLI command

Add `gitcask repos latest <repo-id>` (or `artifacts <repo-id>` — match the existing command naming in `cli/commands/repos.ts`) that calls the new endpoint(s) via `cli/client.ts` and prints with the `cli/format.ts` helpers, modeled on `cli/commands/runs.ts`.

**Verify**: `bun run cli -- --help` → new command listed; `bun run typecheck` → exit 0.

### Step A4: Tests

In `test/api.test.ts`:
1. `GET /repos/:id/latest` with no backup → 404 "No completed backup yet".
2. Seed `env.BUCKET.put("repos/test-owner/test-repo/latest.json", ...)` + matching repo row → 200 with the seeded fields.
3. `GET /repos/:id/artifacts` → seed repo + job + run + 2 artifact rows with distinct `created_at` → 200, 2 rows, newest first, `sha256` present.
4. Unknown repo id for both routes → 404.

**Verify**: `bunx vitest run test/api.test.ts` → all pass including 4 new; then full gate `bun run typecheck && bun run check && bun run test` → exit 0.

## Steps — Part B (design memo)

### Step B1: Write `plans/009-design-restore.md`

A decision memo for the maintainer, max ~2 pages, with these required sections:

1. **Download mechanism — compare exactly three options** with Workers constraints cited: (a) Worker streams `BUCKET.get(key).body` with `Content-Disposition` (simple; Worker egress + request-duration limits on huge artifacts); (b) R2 presigned URL minted with the S3 credentials already in Worker env — `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_ENDPOINT` (no Worker in the byte path; requires `aws4fetch` or similar for SigV4 in-Worker — note bundle-size cost; URLs are bearer-token-like, recommend short expiry); (c) public R2 custom domain (rejected — backups are private; record why).
2. **Recommendation** — pick one (the audit's prior: presigned URLs) and list the implementation steps + new tests it would need.
3. **Integrity verification UX** — how a `gitcask verify` CLI command would work: fetch artifact metadata (Part A endpoint), download, local SHA-256 compare. Note that download must exist first.
4. **Restore semantics** — what "restore" means for a `--mirror` tarball (untar + `git clone <dir>` locally; no server-side restore needed for v1) and what, if anything, the service itself should do (recommendation allowed: nothing server-side in v1).
5. **Open questions for the maintainer** — explicit list (e.g. presigned-URL expiry, whether download counts need audit logging, max artifact size expectations).

**Verify**: file exists; contains the five section headings; contains no implementation code beyond illustrative snippets.

## Test plan

Part A Step A4 (4 new API tests). CLI command is smoke-tested via `--help` registration only (CLI has no test harness — see plans/README.md rejected-findings note).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n '"/:id/latest"' src/routes/repos.ts` and `grep -n '"/:id/artifacts"' src/routes/repos.ts` each match
- [ ] `bun run test` exits 0 including 4 new tests
- [ ] `bun run cli -- --help` lists the new command
- [ ] `test -f plans/009-design-restore.md` and it contains the 5 required sections
- [ ] `bun run typecheck` and `bun run check` exit 0
- [ ] Only in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- You find yourself implementing presigned URLs, streaming, or any download path — that is Part B's memo content, not Part A's code.
- The Miniflare `BUCKET` binding can't be seeded from tests (`env.BUCKET.put` unavailable) — report; do not mock around it.
- `cli/client.ts`'s request helper can't express a plain GET to a new path without modification beyond adding a function.

## Maintenance notes

- Part A's `/repos/:id/artifacts` 50-row cap matches plan 006's bounding philosophy; if pagination lands there, mirror it here.
- The `latest.json` route trusts R2 content written by `callback.ts` — if that writer's shape changes, this route's response changes with it (it deliberately passes the JSON through; no schema pinning).
- When the maintainer picks a download mechanism from the memo, that becomes a new plan (010+) with its own tests — do not bolt it onto this one.
