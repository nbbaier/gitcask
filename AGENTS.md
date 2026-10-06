# Gotchas

- Production is Cloudflare Workers: use Workers bindings (D1/drizzle, R2, Queues, Durable Objects), never `Bun.serve`, `bun:sqlite`, `Bun.redis`, or `Bun.sql`.
- Testing: `bun run test` (vitest + Workers pool); `bun test` cannot load the Workers runtime.

# Pointers

- Writing/reviewing TS, local tooling → `CODING_STANDARDS.md`; run `bun run fix` before committing.
- Architecture, backup lifecycle, module map → `ARCHITECTURE.md`.
- Deploying, wrangler, R2, local Docker → `docs/ops.md`.
- Issues, triage labels, domain terms/ADRs → `docs/agents/`.
- Learned facts: file them into the scoped doc above (landing page → `src/landing/AGENTS.md`), not here.
