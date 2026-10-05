# gitcask state review

Originally reviewed 2026-06-18; refreshed 2026-10-04.

Current gaps and planned work live in
[GitHub Issues](https://github.com/nbbaier/gitcask/issues). Salvaged material
from unmerged branches lives in
[stranded-artifacts/README.md](./stranded-artifacts/README.md). This file
records the durable parts of the review: deployed resources, the backup path,
positioning, and where the landing copy outruns the code.

## Summary

gitcask is a single-tenant Cloudflare backup service: Worker API, D1 schema,
Queues, Cron, job lifecycle, CLI, and a Cloudflare Container backup path, all
on `main`. Production serves `gitcask.com` (#15, #18). The backup is a mirror,
not encryption: the container runs `git clone --mirror`, tars it, computes
SHA-256, uploads to R2 with S3 credentials, and calls the Worker back.

One backup has been verified end-to-end on live infrastructure (#19, closed
2026-07-11): job and run `completed`, artifact row written, downloaded tarball
checksum matched, `latest.json` matched, and the extracted tarball was a bare
repo. A second identical trigger failed after about 15 minutes with no stage
progress (#27, open), so reliability is not yet established.

Baseline tooling is green and enforced: `.github/workflows/ci.yml` runs
`check`, `typecheck`, `knip`, and `test` on push and PR (#12, #13, #17). The
landing page lives in `src/landing/` and is served via Wrangler text-module
imports.

## Source branches

Unmerged branch work was distilled rather than merged. Do not merge these
branches wholesale.

| Branch                      | Outcome                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `feat/backup-observability` | Salvaged to [backup-observability.md](./stranded-artifacts/backup-observability.md); Phase 1 input (#24). |
| `spike/native-git-client`   | Salvaged to [native-git-client.md](./stranded-artifacts/native-git-client.md); parked alternative.    |
| `explore/dynamic-worker`    | Salvaged to [dynamic-workers-opportunities.md](./stranded-artifacts/dynamic-workers-opportunities.md); deferred ideas. |
| `feat/landing-page`         | Superseded: the extracted `src/landing/` structure and text-module rule landed in the June sprint.   |
| `feat/landing-page-2`       | Design reference only; old base.                                                                     |

## Cloudflare resources

IaC is `wrangler.jsonc` (no Alchemy). `env.production` redeclares every binding
because bindings don't inherit (see [ops.md](./ops.md)); both environments
point at the same D1 database, R2 bucket, and queue.

| Resource       | Binding/config                                                | Notes                                                                                                                                      |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Worker         | `name: gitcask`, `main: src/index.ts`                         | Hono app, queue consumer, scheduled handler. Production: custom domain `gitcask.com`, `workers_dev: true`, `WORKER_URL=https://gitcask.com`. |
| D1             | `DB`, `gitcask-db`, id `8fb034f5-4e68-4f19-adad-b112ec374e00` | Stores repos, jobs, runs, artifacts. Migrations in `drizzle/`; remote DB migrated and used in #19.                                          |
| R2             | `BUCKET`, `gitcask-backups`                                   | Worker writes `latest.json`, lists/deletes objects, runs retention cleanup. Container uploads tar/metadata via S3 credentials, not the binding; bucket name is hard-coded in `src/services/backup-dispatcher.ts`. |
| Queue          | `JOB_QUEUE`, `gitcask-jobs` producer/consumer                 | Batch size 1, concurrency 4. Manual/scheduled triggers enqueue; consumer dispatches and retries.                                           |
| Durable Object | `CONTAINER`, class `BackupContainer`                          | Wraps the Cloudflare Container and proxies port 8788.                                                                                      |
| Container      | `gitcask-backup`, `./container/Dockerfile`, basic, max 1      | Deployed and exercised in #19.                                                                                                             |
| Cron           | `*/5 * * * *`                                                 | Scheduler and retention cleanup run on each tick.                                                                                          |

Secrets: `ADMIN_TOKEN`, `GITHUB_PAT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.

## End-to-end backup path

Steps 3 and 5 through 9 ran on live infrastructure in #19 (manual trigger).
The scheduled trigger has automated tests but no recorded live verification.

1. **Auth:** static bearer `ADMIN_TOKEN` on admin routes, `/internal/*`
   callbacks, and `/health/debug/*`. Only `/`, static landing assets, and
   `GET /health` are public.
2. **Repo registration:** `POST /repos` validates fields, interval, duplicate
   owner/name, and GitHub access using `GITHUB_PAT`.
3. **Manual trigger:** `POST /repos/:id/trigger` rejects if a job is queued or
   running, creates a queued job, and sends a `JOB_QUEUE` message.
4. **Scheduled trigger:** cron checks due repos, skips unchanged ones via
   GitHub `pushed_at`, enqueues jobs, and advances `next_run_at`.
5. **Queue dispatch:** consumer marks the job running, dispatches to the
   container, and records or retries dispatch failures.
6. **Clone:** container runs `git clone --mirror` with the PAT, reporting
   stage progress to `/internal/jobs/:id/progress`.
7. **Archive/hash:** container creates `.tar.gz` and SHA-256.
8. **R2 storage:** container uploads the tarball and `_metadata.json` via the
   S3 API. Verify objects through the S3 API, not `wrangler r2` (#26).
9. **Callback/records:** `/internal/jobs/:id/complete` marks the job complete,
   inserts run and artifact rows, writes `latest.json`, and updates repo
   timestamps.
10. **Listing:** partial. `GET /repos/:id/runs` and `GET /runs/:id` exist;
    artifacts are visible only through run detail. Latest/artifact listing is
    #23.
11. **Restore/download:** missing.

## Encryption vs. mirroring

The code implements mirroring, not application-level encryption. The backup
artifact is a tarred `git clone --mirror` directory uploaded to R2 with a
SHA-256 checksum. There is no encryption key model, encrypt/decrypt function,
KMS integration, client-side encryption, encrypted metadata path, or
restore-time decryption path. Any storage-layer encryption Cloudflare provides
is outside this application's code and should not be marketed as gitcask
encrypted backup.

Honest positioning today: automated GitHub mirror backups to R2 with job/run
metadata.

## Claims-vs-reality delta

The June sprint honest-copy pass (#14) removed the earlier filesystem,
queryable-target, restore, and `install.gitcask.dev` claims. Checked against
`src/landing/index.html` on 2026-10-04, these remain looser than the code:

- **"Atomic job flow ... Nothing relies on best-effort polling."** The
  one-active-job check on trigger is check-then-insert, and the database does
  not enforce one active job per repo. Scheduling itself is a five-minute cron
  poll.
- **"Quick setup: Cloudflare Workers, D1, R2, and Queues are the only moving
  parts."** Backups also need Durable Objects and Cloudflare Containers, R2 S3
  credentials, and a GitHub PAT.
- **"Deploy your own: `bun install && bunx wrangler deploy`."** Deploying also
  needs D1 creation and migrations, secrets, and `--env production` config;
  see the README's "Production Deployment" section.
- **"Credentials and git never touch the worker."** Git never runs in the
  Worker, but the Worker holds `GITHUB_PAT` and R2 credentials and passes them
  to the container on dispatch.

`PLAN.md` is archived at
[stranded-artifacts/outdated/PLAN.md](./stranded-artifacts/outdated/PLAN.md)
and is not a source of current claims. Two of its statements still differ from
code: it says repo deletion enqueues async cleanup, but `DELETE /repos/:id`
deletes D1 rows and R2 objects synchronously in the request; and it says there
is no download API in v1, which is still true.
