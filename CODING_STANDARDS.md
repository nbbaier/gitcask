# Coding Standards

Ultracite (Biome) formats and lints everything; `bun run fix` applies its rules, so write code and let it correct style. Spend your attention on what it cannot check: business logic, edge cases, and architecture (see `ARCHITECTURE.md`).

## Tooling

Bun is the local package manager and CLI runtime; production runs on Cloudflare Workers.

- Run files with `bun <file>`, scripts with `bun run <script>`, packages with `bunx`.
- Bun loads `.env` automatically, so read env vars directly.
- Use `Bun.file` for file I/O and `` Bun.$`cmd` `` for shell calls in local tooling.
