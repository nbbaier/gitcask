# gitcask

Automated GitHub repository backup service powered by Cloudflare Workers, D1, R2, and Queues.

## Prerequisites

- [Bun](https://bun.sh) (v1.3.9+)
- Git

## Setup

### 1. Install dependencies

```bash
bun install
cd container && bun install && cd ..
```

### 2. Configure environment variables

Create a `.dev.vars` file in the project root:

```
ADMIN_TOKEN=some-secret-token
GITHUB_PAT=ghp_your_github_pat
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

#### GitHub PAT

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) with the following permissions:


| Permission   | Access    | Why                                            |
| ------------ | --------- | ---------------------------------------------- |
| **Contents** | Read-only | `git clone --mirror` to back up repo data      |
| **Metadata** | Read-only | Fetch repo description, topics, language, etc. |


You can scope the token to "All repositories" or limit it to specific repos.

#### R2 credentials

For local-only testing, the Worker's R2 binding uses local emulation via Miniflare, so R2 credentials can be dummy values. However, the **container service** uploads via the S3 API directly, so full end-to-end testing requires real R2 API credentials.

### 3. Run D1 migrations

```bash
bun run db:migrate:local
```

## Local development

Start the container service and worker in two separate terminals:

```bash
# Terminal 1 — container backup service (port 8788)
cd container && bun run server.ts

# Terminal 2 — Cloudflare Worker (port 8787)
bun run dev
```

### Test the API

```bash
# Health check (no auth required)
curl http://localhost:8787/health

# Add a repo to back up
curl -X POST http://localhost:8787/repos \
  -H "Authorization: Bearer some-secret-token" \
  -H "Content-Type: application/
  -d '{"owner":"nbbaier","name":"gitcask","interval_minutes":60}'

# List repos
curl http://localhost:8787/repos \
  -H "Authorization: Bearer some-secret-token"

# Manually trigger a backup
curl -X POST http://localhost:8787/repos/<repo-id>/trigger \
  -H "Authorization: Bearer some-secret-token"

# Check backup runs
curl http://localhost:8787/repos/<repo-id>/runs \
  -H "Authorization: Bearer some-secret-token"
```

### Run tests

```bash
bun run test
```

Tests use Miniflare for local emulation — no real Cloudflare services needed.

### Notes

- **Cron triggers** don't fire automatically in `wrangler dev`. You can test the scheduler manually via `curl http://localhost:8787/__scheduled`.
- **Queue processing** is emulated locally by Miniflare.
- **Full end-to-end testing** (container cloning a repo and uploading to R2) requires real R2 API credentials and a valid GitHub PAT.

## Scripts


| Script                     | Description                     |
| -------------------------- | ------------------------------- |
| `bun run dev`              | Start the Worker locally        |
| `bun run deploy`           | Deploy the Worker to Cloudflare |
| `bun run db:generate`      | Generate D1 migration files     |
| `bun run db:migrate:local` | Apply D1 migrations locally     |
| `bun run test`             | Run tests                       |
| `bun run test:watch`       | Run tests in watch mode         |


## Production Deployment

### 1. Create Cloudflare resources

```bash
# Create the D1 database
bunx wrangler d1 create gitcask-db

# Create the R2 bucket
bunx wrangler r2 bucket create gitcask-backups

# Create the queue
bunx wrangler queues create gitcask-jobs
```

After creating the D1 database, copy the returned `database_id` and update `wrangler.jsonc` — the current value (`"gitcask-db-id"`) is a placeholder.

### 2. Set production secrets

```bash
bunx wrangler secret put ADMIN_TOKEN
bunx wrangler secret put GITHUB_PAT
bunx wrangler secret put R2_ACCESS_KEY_ID
bunx wrangler secret put R2_SECRET_ACCESS_KEY
bunx wrangler secret put R2_ENDPOINT
```

### 3. Update production environment variables

The `env.production` section in `wrangler.jsonc` overrides `WORKER_URL` for production. Update it to match your Workers subdomain:

```jsonc
"env": {
  "production": {
    "vars": {
      "WORKER_URL": "https://gitcask.<your-subdomain>.workers.dev"
    }
  }
}
```

The container service is accessed via a Cloudflare Container binding (`CONTAINER`), so no URL configuration is needed for it.

### 4. Run D1 migrations remotely

```bash
bunx wrangler d1 migrations apply gitcask-db --remote
```

### 5. Deploy the Worker

```bash
bunx wrangler deploy --env production
```

### Deployment checklist

- D1 database created and `database_id` updated in `wrangler.jsonc`
- R2 bucket created
- Queue created
- Secrets set (`ADMIN_TOKEN`, `GITHUB_PAT`, R2 credentials)
- `WORKER_URL` updated in `env.production` vars
- D1 migrations applied remotely
- Worker deployed with `bunx wrangler deploy --env production`

