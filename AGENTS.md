<coding_guidelines>
# Gotchas

- Production is Cloudflare Workers: use Workers bindings (D1/drizzle, R2, Queues, Durable Objects) in place of `Bun.serve`, `bun:sqlite`, `Bun.redis`, or `Bun.sql`.
- Run tests with `bun run test` (vitest + `@cloudflare/vitest-plugin`); `bun test` cannot load the Workers runtime.
- Call the globally installed `wrangler`; the project-local copy lags behind.

# Pointers

- Writing or reviewing TS, or running local tooling: read `CODING_STANDARDS.md`; run `bun run fix` before committing.
- Architecture, backup lifecycle, module map: `ARCHITECTURE.md`. Production and R2 gotchas: `docs/ops.md`.
- Issues, triage labels, and domain docs (`GLOSSARY.md`, `docs/adr/`): `docs/agents/`.

## Learned User Preferences

- When iterating on landing page layout, preserve production files and apply experiments in cloned variants (e.g. `index-alt.html`)
- Prefer semantic landing markup: all page sections inside `<main>`, full-bleed section backgrounds (`.field`) with inner content constrained by `.shell`

## Learned Workspace Facts

- `wrangler dev` requires Docker with Buildx because the worker defines a container binding (`BackupContainer`, image `./container/Dockerfile`)
- Local Docker runs via OrbStack; active context should be `orbstack`, and `docker-buildx` must be available (Homebrew plugin path in `~/.docker/config.json` `cliPluginsExtraDirs`)
- Static landing page sources live under `src/landing/` (e.g. `index.html`, `index-alt.html` with paired CSS files)
</coding_guidelines>
