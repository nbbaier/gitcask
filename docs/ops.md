# Operations gotchas

The routine steps (secrets, migrations, deploy) are in the README's "Production Deployment" section. This file covers what the README doesn't: things that bit previous sessions.

## Bindings

`env.production` in `wrangler.jsonc` does **not** inherit top-level bindings: D1, R2, Queues, the container/DO binding, and vars. When you add a binding, add it in both places, otherwise production deploys without it. Wrangler only warns about this; it doesn't fail.

## Secrets

- `.dev.vars` holds the Worker secrets: `ADMIN_TOKEN` (same value as production), `GITHUB_PAT`, and `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.
- `.env` holds the CLI config: `GITCASK_URL`, `GITCASK_TOKEN`. Bun loads it automatically.

## Production checks

- Health: `curl -s https://gitcask.com/health`. Only D1 decides `ok` vs `degraded`. `container: "unreachable"` right after a deploy is a cold start, not an outage.
- Remote D1: `wrangler d1 execute gitcask-db --remote --env=production --command "..."`. Without `--env=production`, wrangler targets the top-level config.
- Logs: `wrangler tail --env=production`. Start it before triggering a backup and keep it running for the whole job (up to 15 min); a short-lived tail misses the consumer and callback logs.

## Verifying R2 objects

Verify backups through the S3 API (the same path the container uses), not with `wrangler r2 object get`. The wrangler CLI has shown a stale, divergent view of `gitcask-backups`, with missing keys and checksum mismatches on objects that were fine (#26). Run any S3 scratch script from the repo root so it resolves `@aws-sdk/client-s3`; the `aws` CLI isn't installed.
