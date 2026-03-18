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
WORKER_URL=http://localhost:8787
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret-key
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

#### GitHub PAT

Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens) with the following permissions:

| Permission   | Access    | Why                                              |
| ------------ | --------- | ------------------------------------------------ |
| **Contents** | Read-only | `git clone --mirror` to back up repo data        |
| **Metadata** | Read-only | Fetch repo description, topics, language, etc.   |

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
  -H "Content-Type: application/json" \
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

| Script                | Description                          |
| --------------------- | ------------------------------------ |
| `bun run dev`         | Start the Worker locally             |
| `bun run deploy`      | Deploy the Worker to Cloudflare      |
| `bun run db:generate` | Generate D1 migration files          |
| `bun run db:migrate:local` | Apply D1 migrations locally     |
| `bun run test`        | Run tests                            |
| `bun run test:watch`  | Run tests in watch mode              |
