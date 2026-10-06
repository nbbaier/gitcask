# Runtime & Tooling (Bun)

This project runs on Cloudflare Workers (Hono + D1/drizzle + R2 + Queues + Durable Objects), deployed via `wrangler`. Bun is used locally for the CLI (`bin/gitcask` → `cli/index.ts`) and as the package manager, not as the production runtime — so default to Bun for local tooling instead of Node.js, but don't reach for `Bun.serve()`, `bun:sqlite`, `Bun.redis`, or `Bun.sql`.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>` (e.g. running the CLI)
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`, except `wrangler`: call the globally installed `wrangler` directly (the project-local copy lags behind)
- Bun automatically loads .env, so don't use dotenv.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa

Tests run via `vitest` (`bun test` doesn't work here — `@cloudflare/vitest-plugin` is required to run tests inside the Workers runtime).

Architecture, backup lifecycle, and module map: `ARCHITECTURE.md`. Production and R2 gotchas: `docs/ops.md`. Full local check: `bun run verify`.

# Coding Standards

Before writing or reviewing TS code, read `CODING_STANDARDS.md`; run `bun run fix` before committing.

# Agent skills

### Issue tracker

Issues live in GitHub Issues (nbbaier/gitcask), managed via the `gh` CLI. External PRs are not treated as a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

All five triage roles use their default label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `GLOSSARY.md` and `docs/adr/` at the repo root (`docs/adr/` not created yet; skills create it lazily). See `docs/agents/domain.md`.

## Learned User Preferences

- When iterating on landing page layout, preserve production files and apply experiments in cloned variants (e.g. `index-alt.html`)
- Prefer semantic landing markup: all page sections inside `<main>`, full-bleed section backgrounds (`.field`) with inner content constrained by `.shell`

## Learned Workspace Facts

- `wrangler dev` requires Docker with Buildx because the worker defines a container binding (`BackupContainer`, image `./container/Dockerfile`)
- Local Docker runs via OrbStack; active context should be `orbstack`, and `docker-buildx` must be available (Homebrew plugin path in `~/.docker/config.json` `cliPluginsExtraDirs`)
- Static landing page sources live under `src/landing/` (e.g. `index.html`, `index-alt.html` with paired CSS files)
