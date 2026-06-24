# Plan 001: Establish a verification baseline — typecheck script, green lint, and CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- package.json test/env.d.ts biome.jsonc .github/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

The repo has tests (vitest) and lint (ultracite/Biome) but **no typecheck script and no CI of any kind** — there is no `.github/workflows/` directory. Type errors can ship silently: nothing runs `tsc` anywhere in the dev or deploy flow. Every other plan in `plans/` uses "typecheck passes, tests pass, lint passes" as its verification gate, so this plan must land first. The good news: as of the planned-at commit, `bunx tsc --noEmit` already exits 0 and all 24 tests pass, so this is wiring, not fixing.

## Current state

- `package.json` — scripts block (lines 17–26) has `test`, `test:watch`, `check` (lint), `fix`, `dev`, `deploy`, `db:generate`, `db:migrate:local`, `cli`. **No typecheck script.**
- `tsconfig.json` — exists at repo root, `strict: true`. `bunx tsc --noEmit` exits 0 today (verified 2026-06-10).
- `bun run test` — 3 files, 24 tests, all pass in ~1.2s using `@cloudflare/vitest-pool-workers` (Miniflare; no real Cloudflare services or network needed).
- `bun run check` (ultracite/Biome) currently **fails with exactly 2 errors**:
  1. `.claude/settings.local.json` — formatter diff (file is local agent config, should be excluded from linting, not reformatted).
  2. `test/env.d.ts:3:9` — `lint/style/noNamespace` on `declare module "cloudflare:test" { ... }`-style ambient declaration. This is the canonical vitest-pool-workers pattern and must be suppressed, not rewritten.
- `biome.jsonc` (repo root, 5 lines) — minimal config extending ultracite:

```jsonc
// biome.jsonc (entire file)
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "extends": ["ultracite"]
}
```

(If the live file differs slightly, preserve whatever is there and only ADD the overrides described in Step 2.)

- No `.github/` directory exists.
- The project uses **Bun** as its package manager and runner (`bun.lock` at root). Per repo convention (CLAUDE.md): use `bun install`, `bun run <script>`, `bunx <pkg>` — never npm/yarn/pnpm/npx.
- `typescript` is declared as a peerDependency (`^6.0.2`) and is present in `node_modules` (tsc resolves via `bunx tsc`).
- Note: the `container/` directory has its own `package.json`/`bun.lock`; tests do NOT require installing or running the container.

## Commands you will need

| Purpose   | Command              | Expected on success            |
|-----------|----------------------|--------------------------------|
| Install   | `bun install`        | exit 0                         |
| Typecheck | `bunx tsc --noEmit`  | exit 0, no output              |
| Tests     | `bun run test`       | `Tests  24 passed (24)` (or more) |
| Lint      | `bun run check`      | exit 0 after Step 2            |

## Scope

**In scope** (the only files you should modify/create):
- `package.json` (add one script)
- `biome.jsonc` (add ignore entries)
- `test/env.d.ts` (add a suppression comment only)
- `.github/workflows/ci.yml` (create)

**Out of scope** (do NOT touch):
- Any file in `src/`, `cli/`, `container/` — this plan changes no application code.
- `wrangler.jsonc`, deploy scripts — CI here is verification-only, no deploy job.
- `.claude/settings.local.json` itself — do not reformat it; exclude it from lint instead.

## Git workflow

- Branch: `dx/001-verification-baseline`
- Commit style: conventional commits, e.g. `chore: add typecheck script and CI workflow` (matches repo history: `chore: pin bun.lock dependencies to fixed versions`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a `typecheck` script

In `package.json` scripts, add:

```json
"typecheck": "tsc --noEmit"
```

**Verify**: `bun run typecheck` → exit 0, no errors.

### Step 2: Make lint green without touching application code

In `biome.jsonc`, exclude local agent config from all Biome processing. Biome v2 uses `files.includes` with negated globs:

```jsonc
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "extends": ["ultracite"],
  "files": {
    "includes": ["**", "!**/.claude/**", "!**/.cachebro/**"]
  }
}
```

In `test/env.d.ts`, add a suppression comment directly above the `declare module` (line 3) flagged by `lint/style/noNamespace`:

```ts
// biome-ignore lint/style/noNamespace: ambient module declaration required by @cloudflare/vitest-pool-workers
```

(Use the exact rule name from the error output. If the error is on a `declare namespace` line instead, place the comment above that line.)

**Verify**: `bun run check` → exit 0, "Found 0 errors" (warnings acceptable).

### Step 3: Create the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - name: Typecheck
        run: bun run typecheck
      - name: Lint
        run: bun run check
      - name: Test
        run: bun run test
```

**Verify**: `bunx yaml-lint .github/workflows/ci.yml` if available; otherwise validate the YAML parses: `bun -e "const f=await Bun.file('.github/workflows/ci.yml').text(); console.log('bytes', f.length)"` → prints a byte count, and visually confirm indentation matches the block above.

### Step 4: Full local gate

Run all three gates in sequence.

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0, 24+ tests pass.

## Test plan

No new tests — this plan adds verification infrastructure. The existing suite (24 tests) must still pass unchanged.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run typecheck` exits 0
- [ ] `bun run check` exits 0
- [ ] `bun run test` exits 0 with 24+ tests passing
- [ ] `.github/workflows/ci.yml` exists and contains typecheck, lint, and test steps
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `bunx tsc --noEmit` fails BEFORE you make any change (baseline has drifted — type errors were introduced after this plan was written; report them, do not fix them under this plan).
- `bun run check` reports errors in files other than the two named above.
- Suppressing the `test/env.d.ts` error requires rewriting the declaration rather than a `biome-ignore` comment.

## Maintenance notes

- Future plans (002–009) assume `bun run typecheck` exists — if the script is renamed, update their command tables.
- The CI workflow intentionally has no deploy job; deployment stays manual via `bun run deploy`.
- If `container/` gains tests later, CI needs a second job with `cd container && bun install`.
