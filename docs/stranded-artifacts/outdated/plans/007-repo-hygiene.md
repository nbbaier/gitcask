# Plan 007: Repo hygiene — gitignore gaps, junk files, wrangler config dedup, landing-page extraction

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- .gitignore wrangler.jsonc src/index.ts src/landing/ package.json README.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (Step 3 — wrangler dedup — is MED; it changes what deploys to production. Its verification step is mandatory.)
- **Depends on**: plans/001-verification-baseline.md
- **Category**: dx
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

Four small messes with real costs: (1) `.env` at the repo root holds a live bearer token (`GITCASK_TOKEN` — the CLI's admin token) and is **not gitignored** — one `git add .` away from being committed; (2) macOS `.DS_Store` files and agent-tool caches (`src/landing/.cachebro/`) sit in the tree as noise; (3) `wrangler.jsonc` duplicates the entire binding set between top level and `env.production` with only `WORKER_URL` differing — wrangler does **not** inherit binding keys into named environments, so every future binding change must be made twice or production silently drifts; (4) `src/index.ts` is 533 lines, 479 of which are an inline HTML landing page, burying the actual app wiring.

## Current state

- `.gitignore` (entire file):

```
node_modules/
dist/
.wrangler/
.dev.vars
*.log
.cursor/hooks/state/continual-learning.json
```

Missing: `.env`, `.DS_Store`, `.cachebro/`. Verified at planning time: `.env` is **untracked** (never committed — `git ls-files` shows nothing), so this is prevention, not history surgery. Do NOT print the `.env` contents anywhere.

- Junk files present: `.DS_Store` at root, `src/.DS_Store`, `cli/.DS_Store`, `src/landing/.DS_Store`; `src/landing/.cachebro/cache.db` + `cache.db-wal`. Also `src/landing/.claude/settings.local.json` (leave it; just ensure ignored patterns don't sweep `.claude/` config you shouldn't delete).
- `wrangler.jsonc` — top-level config (lines ~1–62: `vars.WORKER_URL = "http://localhost:8787"`, `d1_databases`, `r2_buckets`, `queues`, `durable_objects`, `migrations`, `triggers`, `containers`) and an `env.production` block (lines ~64 onward) that repeats **every binding identically** — same `database_id`, same bucket, same queue, same container — differing only in `vars.WORKER_URL = "https://gitcask-production.nico-baier.workers.dev"`.
- `package.json` deploy script: `"deploy": "wrangler deploy --env=production"`. Dev script: `"dev": "wrangler dev"` (uses top-level config + `.dev.vars` overrides).
- Wrangler fact this plan exploits: `wrangler dev` reads `.dev.vars` and its values **override** `vars` from the config file. So local dev does not need the top-level `WORKER_URL` to be the localhost value — it can come from `.dev.vars`.
- `src/index.ts` — lines 18–496 are `app.get("/", (c) => { const html = `<!doctype html>...`; return c.html(html); })`. The HTML is a static template literal with **no interpolation** (verify with a quick scan for `${` inside it — at planning time there is none). Lines 1–17 and 498–533 are the real app wiring.
- `src/landing/` exists but contains only the junk listed above — extracting the page there gives the directory a purpose.
- Test guard: `test/api.test.ts` has `describe("GET /")` asserting the landing page returns 200 HTML containing `"the repo"` and `"gitcask"`.
- **Untouched by this plan**: the 9 currently-staged agent-config files (`.agents/`, `.codex/`, `.cursor/`, `.opencode/`, `.mcp.json`, `opencode.json`, `.claude/skills/`) — whether those belong in the repo is the operator's call, and they may be deliberately staged. Do not stage, unstage, or ignore them.

## Commands you will need

| Purpose      | Command                                                                                              | Expected on success                  |
| ------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Typecheck    | `bun run typecheck`                                                                                  | exit 0                               |
| Tests        | `bun run test`                                                                                       | all pass                             |
| Lint         | `bun run check`                                                                                      | exit 0                               |
| Dry-run prod | `bunx wrangler deploy --dry-run --env=production` then after Step 3 `bunx wrangler deploy --dry-run` | builds successfully, bindings listed |

## Scope

**In scope** (the only files you should modify/create/delete):

- `.gitignore`
- Delete: `.DS_Store`, `src/.DS_Store`, `cli/.DS_Store`, `src/landing/.DS_Store`, `src/landing/.cachebro/` (directory)
- `wrangler.jsonc`
- `package.json` (deploy script only)
- `README.md` (deploy + env-var docs only)
- `src/index.ts`, `src/landing/page.ts` (create)
- `.dev.vars` (append one line — do not read it into any report)

**Out of scope** (do NOT touch):

- `.env` contents and the staged agent-config files (see Current state).
- `src/landing/.claude/settings.local.json` — leave in place.
- Any other route or service code.

## Git workflow

- Branch: `chore/007-repo-hygiene`
- Commit style: conventional commits; suggested: `chore: ignore env and OS junk files`, `chore: deduplicate wrangler config`, `refactor: extract landing page from index.ts`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Gitignore + junk removal

Append to `.gitignore`:

```
.env
.DS_Store
**/.DS_Store
.cachebro/
**/.cachebro/
```

Delete the four `.DS_Store` files and the `src/landing/.cachebro/` directory.

**Verify**: `git status --short | grep -E "\.env$|\.DS_Store|\.cachebro"` → no output (untracked-and-ignored files disappear from status; nothing staged for them).

### Step 2: Recommend token rotation (report only)

The `GITCASK_TOKEN` value in `.env` was exposed to local tooling transcripts during the audit. Do not read or print it. In your completion report, remind the operator: rotate `ADMIN_TOKEN` (`bunx wrangler secret put ADMIN_TOKEN`) and update `.env` to match.

**Verify**: nothing to run — confirm the reminder text is in your report.

### Step 3: Deduplicate wrangler.jsonc

Strategy: make the **top level** the production config and delete `env.production` entirely; local dev gets its `WORKER_URL` from `.dev.vars`.

1. In `wrangler.jsonc`, set the top-level `vars.WORKER_URL` to `"https://gitcask-production.nico-baier.workers.dev"` (the value currently in `env.production.vars`).
2. Delete the entire `"env"` block.
3. Append to `.dev.vars` (do not echo the file): `WORKER_URL=http://localhost:8787`
4. In `package.json`, change the deploy script to `"deploy": "wrangler deploy"`.
5. Update README's deploy instructions (`bunx wrangler deploy --env production` → `bunx wrangler deploy`, and the `env.production` paragraph → a note that `WORKER_URL` is set at top level and overridden locally via `.dev.vars`).

**Verify (mandatory, both)**:

- `bunx wrangler deploy --dry-run` → succeeds; output lists the D1 binding (`gitcask-db`), R2 bucket (`gitcask-backups`), queue producer+consumer (`gitcask-jobs`), the container/DO (`BackupContainer`), and cron trigger — i.e. identical bindings to what `--env=production` showed before the change. Run the before-version first if unsure and diff the two outputs.
- `bun run test` → all pass (vitest reads `wrangler.jsonc` via `vitest.config.ts`; this confirms the config still parses and bindings resolve).

### Step 4: Extract the landing page

1. Create `src/landing/page.ts` containing the full HTML template literal from `src/index.ts:19-493`, exported as a constant:

```ts
export const landingPage = `<!doctype html>
...entire existing HTML, byte-for-byte...
</html>`;
```

2. In `src/index.ts`, replace the inline route with:

```ts
import { landingPage } from "./landing/page.ts";
// ...
app.get("/", (c) => c.html(landingPage));
```

Byte-for-byte move — do not reformat, retitle, or "improve" the HTML.

**Verify**: `bun run typecheck` → exit 0; `bunx vitest run test/api.test.ts` → the `GET /` landing-page test passes; `wc -l src/index.ts` → under 80 lines.

### Step 5: Full gate

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0.

## Test plan

No new tests. Existing guards: the `GET /` landing test (Step 4) and the full suite via the wrangler config (Step 3).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `git check-ignore .env .DS_Store src/.DS_Store` → exits 0 (all ignored)
- [ ] `find . -name ".DS_Store" -not -path "./node_modules/*" | wc -l` → 0
- [ ] `grep -c "env" wrangler.jsonc` shows no `"env"` block (manual confirm: file has a single flat config)
- [ ] `bunx wrangler deploy --dry-run` succeeds with the full binding set
- [ ] `wc -l src/index.ts` < 80 and `test -f src/landing/page.ts`
- [ ] `bun run typecheck && bun run check && bun run test` exit 0
- [ ] `plans/README.md` status row updated, including the token-rotation reminder

## STOP conditions

Stop and report back (do not improvise) if:

- The landing HTML in `src/index.ts` contains `${` interpolation (it didn't at planning time) — a plain-string move would break it.
- The `--dry-run` binding lists differ between the old `--env=production` config and the new flat config in ANY way other than removal of the env name.
- `.env` turns out to be tracked by git after all (`git ls-files .env` non-empty) — that changes Step 2 from "rotate as hygiene" to "rotate immediately + history is burned"; report before proceeding.
- `wrangler dev` documentation/behavior for `.dev.vars` overriding `vars` does not hold in the installed wrangler version (smoke-check: `bun run dev` locally and confirm the landing page loads and logs show localhost WORKER_URL — only if the operator environment permits running dev).

## Maintenance notes

- After this lands, **every** wrangler binding change is made exactly once, at top level. If a real second environment (staging) ever appears, reintroduce `env.<name>` for that environment only — and accept the duplication wrangler forces, or generate the config.
- The deploy script no longer carries `--env=production`; CI/automation that calls `wrangler deploy --env=production` directly (none known at planning time) would break — grep for it if scripts are added later.
- `src/landing/page.ts` is the place for future landing iterations; keep `src/index.ts` to wiring only.
