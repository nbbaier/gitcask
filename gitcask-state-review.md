# gitcask State Review v2

Review date: 2026-06-18

Default branch verified: `origin/main`

Ref refresh: `git fetch --all --prune` succeeded and pruned `origin/refactor/backup-dispatcher` and `origin/refactor/job-lifecycle`.

## Summary

gitcask is a real but unfinished single-tenant Cloudflare backup service: Worker API, D1 schema, Queues, Cron, job lifecycle, CLI, and a Cloudflare Container backup path all exist on `main`. The intended backup flow is mirroring, not encryption: the container runs `git clone --mirror`, creates a tarball, computes SHA-256, uploads to R2 through S3 credentials, and calls the Worker back. The strongest current demo path is still a narrow "configure repo -> trigger backup -> inspect run/artifact record" flow, but the actual clone/upload/callback path is implemented-but-unverified without live GitHub/R2/Cloudflare secrets. The stranded branches contain several worthwhile design and landing-page artifacts, but no unmerged production code should be merged wholesale.

## Branch inventory

Ahead/behind is relative to `origin/main`. Matching local/remote branches were checked for divergence; all matching unmerged local/remote pairs are identical.

| Branch | Local/remote | Last commit | Author | Ahead/behind | Status | Read |
|---|---|---:|---|---:|---|---|
| `main` | local + `origin/main` + `origin/HEAD` | 2026-06-16 | Nico Baier | 0 / 0 | default | Current trunk. |
| `explore/dynamic-worker` | local + remote | 2026-03-26 | Nico Baier | 1 / 20 | unmerged | Dynamic Workers idea spike; partial conceptual overlap with later main. |
| `feat/backup-observability` | local only | 2026-05-25 | Nico Baier | 3 / 3 | unmerged | Backup observability/domain/workflows design spike. |
| `feat/landing-page` | local + remote | 2026-04-09 | Nico Baier | 13 / 20 | unmerged | Extracted landing page implementation; conflicts with current inline page/main code. |
| `feat/landing-page-2` | local + remote | 2026-05-16 | Nico Baier | 1 / 18 | unmerged | Alternate standalone landing-page concepts; old base. |
| `spike/native-git-client` | local + remote | 2026-05-25 | Nico Baier | 1 / 3 | unmerged | Native Worker git-client design spike. |
| `claude/review-plan-O8OqK` | local + remote | 2026-03-18 | Nico Baier | 0 / 34 | merged | Fully contained in main; cleanup candidate. |
| `feat/cli` | local + remote | 2026-03-18 | Nico Baier | 0 / 26 | merged | Fully contained in main; cleanup candidate. |

Merged / already integrated note: `claude/review-plan-O8OqK` and `feat/cli` are commit-graph merged into `origin/main`, so no branch worktree/subagent was used for them. The previously visible remote-only refactor branches were pruned by fetch.

## Unmerged branch deep-dives

### `explore/dynamic-worker`

- **Branch:** `explore/dynamic-worker` · 2026-03-26 12:44:41 -0500 · Nico Baier `<nico.baier@gmail.com>` · ahead 1 / behind 20 vs `origin/main`
- **Purpose:** Explore where Cloudflare Dynamic Workers could augment gitcask around validation, skip logic, webhooks, verification, enrichment, and cleanup.
- **State:** spike
- **Already integrated?** partial — the branch only adds `docs/dynamic-workers-opportunities.md`; `origin/main` has no Dynamic Workers equivalent, but later main work independently implemented adjacent repo access validation, change detection, and R2 cleanup.
- **Notable work:** Seven idea sections: pre-backup repo validation, ref-fingerprint change detection, completion webhooks with retry, R2 artifact integrity verification, metadata enrichment, orphan cleanup, backup diff summaries; plus a pattern that keeps heavy git work in containers and light coordination in Dynamic Workers.
- **Relationship to `main`:** net-new doc with partial conceptual overlap against current change detection and cleanup code.
- **Salvage recommendation:** cherry-pick specific parts — keep Dynamic Worker architecture framing and unimplemented ideas: success webhook retry, artifact verification, metadata enrichment, backup diff summary; revise stale scheduler/change-detection claims.
- **Effort & risk to integrate:** docs-only salvage is low effort; implementation is medium/high risk because it would touch Cloudflare runtime/bindings, webhook semantics, R2 scanning, GitHub rate limits, and now-stale scheduler/callback assumptions.
- **At risk of being lost:** Unique commit `91076df`; especially the Dynamic Worker-specific framing for lightweight auxiliary tasks and verification/enrichment/diff-summary ideas absent from `main`.

### `feat/backup-observability`

- **Branch:** `feat/backup-observability` · 2026-05-25T16:08:50-05:00 · Nico Baier `<nico.baier@gmail.com>` · ahead 3 / behind 3 vs `origin/main`
- **Purpose:** Design a durable observability model for backup jobs, including job events, stages, heartbeats, stale-job detection, and related domain docs.
- **State:** spike
- **Already integrated?** partial — content is not commit-integrated, and `main` has no `job_events`, `Job Event`, `container_accepted`, `dispatch_started`, or Cloudflare Workflows equivalent. Main overlaps with some follow-up ideas through `plans/003`, `plans/004`, and `plans/009`.
- **Notable work:** `docs/plans/BACKUP_OBSERVABILITY_PLAN.md`, `docs/plans/BACKUP_ORCHESTRATION_ENGINE.md`, `CONTEXT.md` glossary, `docs/adr/0001-in-flight-jobs-separate-from-outcomes.md`, `docs/HANDOFFS.md`, and doc reorganization from `PLAN.md`/`review/*` into `docs/`.
- **Relationship to `main`:** extends main, but conflicts with current planning layout: `main` now uses `plans/00x-*`, while this branch moves legacy docs under `docs/plans` and `docs/reviews`.
- **Salvage recommendation:** cherry-pick specific parts — keep `BACKUP_OBSERVABILITY_PLAN.md`, `BACKUP_ORCHESTRATION_ENGINE.md`, `CONTEXT.md`, and the ADR; do not take the directory rename as-is.
- **Effort & risk to integrate:** small-to-medium, mostly docs reconciliation; risks are broken links, duplicated plan language, and deciding whether `plans/` or `docs/plans/` is canonical.
- **At risk of being lost:** Unique commits `719a63a`, `6eafacd`, `33f5953`; especially the durable `job_events` lifecycle model, status/stage vocabulary, heartbeat/staleness design, terminal callback idempotency notes, and Workflows migration memo.

### `feat/landing-page`

- **Branch:** `feat/landing-page` · 2026-04-09 09:56:41 -0500 · Nico Baier `<nico.baier@gmail.com>` · ahead 13 / behind 20 vs `origin/main`
- **Purpose:** Build a branded landing page for gitcask and wire `/` plus `/styles.css` into the Worker.
- **State:** partial
- **Already integrated?** partial — `origin/main` has an earlier inline landing page in `src/index.ts` from `33a5a60 some frontend experimention`, plus some agent/editor config files. The branch's final extracted implementation (`src/landing/DESIGN.md`, `src/landing/index.html`, `src/landing/styles.css`) is absent from `main`.
- **Notable work:** `src/landing/index.html` final static landing page, `src/landing/styles.css` responsive editorial/brutalist styling, `src/landing/DESIGN.md` design brief, `src/index.ts` text-module import/route pattern, and `wrangler.jsonc` Text rules for HTML/CSS modules.
- **Relationship to `main`:** conflicts — main already contains an inline homepage and newer backend/tests/docs. Merging this branch directly would delete or regress mainline work.
- **Salvage recommendation:** cherry-pick specific parts — `src/landing/DESIGN.md`, `src/landing/index.html`, `src/landing/styles.css`, the small `src/index.ts` import/route pattern, and the `wrangler.jsonc` Text rule; update copy before shipping.
- **Effort & risk to integrate:** small-to-medium, roughly 0.5-1 day; risks are reconciling the existing inline `/` route, validating Wrangler text-module imports, preserving newer backend changes, and checking marketing copy against actual product state.
- **At risk of being lost:** The final "your repos, always safe" landing concept, externalized static asset structure, design system notes, and `/styles.css` serving approach.

### `feat/landing-page-2`

- **Branch:** `feat/landing-page-2` · 2026-05-16T12:36:58-05:00 · Nico Baier `<nico.baier@gmail.com>` · ahead 1 / behind 18 vs `origin/main`
- **Purpose:** Experiment with standalone marketing/landing-page concepts for gitcask.
- **State:** experimental
- **Already integrated?** partial — `origin/main` already has a homepage experiment and most uidotsh/MCP config files, but branch-only `src/landing/dev.ts`, `src/landing/index.html`, and `src/landing/styles.css` are absent from `main`; key copy like "Your repos, always backed up" is not on `main`.
- **Notable work:** `src/landing/index.html` contains three separate landing concepts: Developer CLI, Vault/premium editorial, and Infrastructure/dark mode. `src/landing/dev.ts` serves a standalone Bun preview. `src/landing/styles.css` defines Tailwind theme/fonts. `package.json` adds `tailwindcss` and `@tailwindcss/cli`.
- **Relationship to `main`:** duplicates/conflicts — based on an old app state and overlaps landing/config work; direct merge would clobber newer API/service/docs/test work.
- **Salvage recommendation:** cherry-pick specific parts — keep `src/landing/index.html` as design reference or extract one preferred concept; possibly keep `.amp/settings.json` if desired. Do not merge/rebase wholesale.
- **Effort & risk to integrate:** small-to-medium if used as design source, high if merging branch state. Risks are clobbering newer `src/index.ts`, API/service refactors, docs/plans, tests, deploy script changes, and Cloudflare workflow updates.
- **At risk of being lost:** Three alternate landing-page concepts, standalone Bun preview server, and Tailwind/font theme setup.

### `spike/native-git-client`

- **Branch:** `spike/native-git-client` · 2026-05-25T23:06:16-05:00 · Nico Baier `<nico.baier@gmail.com>` · ahead 1 / behind 3 vs `origin/main`
- **Purpose:** Explore replacing the container-based `git clone --mirror` backup path with a native Cloudflare Worker git smart-HTTP client storing packfiles in R2.
- **State:** spike
- **Already integrated?** no — diff adds only `docs/spike-native-git-client.md`; `main` has adjacent restore planning in `plans/009`, but no `git-upload-pack`, raw packfile, `refs.json`, or git-on-Cloudflare design.
- **Notable work:** Packfile + refs sidecar as canonical R2 storage, lazy `tar.gz` materialization, rejection of GitHub tarball endpoint, `isomorphic-git` evaluation, Worker CPU/memory/R2 multipart constraints, and future gitcask-served `git clone` endpoint.
- **Relationship to `main`:** extends main — net-new design doc, conceptually adjacent to restore/read API planning but not duplicated.
- **Salvage recommendation:** cherry-pick specific parts — bring over `docs/spike-native-git-client.md` or fold packfile/refs + lazy tarball sections into plan 009/restore design.
- **Effort & risk to integrate:** low effort and low merge risk as docs; main risk is conceptual drift with current tarball artifact assumptions and SHA/path compatibility.
- **At risk of being lost:** Native Worker git client proposal: smart HTTP `git-upload-pack`, canonical `.pack` + `.refs.json` R2 layout, lazy tarball generation, Worker resource constraints, and gitcask-hosted clone endpoint idea.

## Salvage map

1. **Backup visibility / restore planning from `plans/009` + `spike/native-git-client`**
   - Pulled into: [docs/stranded-artifacts/native-git-client.md](./docs/stranded-artifacts/native-git-client.md)
   - Pair with: [plans/009-restore-read-api-spike.md](./plans/009-restore-read-api-spike.md)
   - Action: decide whether `tar.gz` remains only the download artifact or also the canonical storage format.
   - Unlocks: a sharper decision between tarball download, presigned URL, and future packfile-native storage.
   - Effort/risk: low as docs; medium/high only if implemented because it challenges the current tarball-as-primary-artifact model.

2. **Durable job observability model from `feat/backup-observability`**
   - Pulled into: [docs/stranded-artifacts/backup-observability.md](./docs/stranded-artifacts/backup-observability.md)
   - Action: turn the job-event/heartbeat/staleness model into a schema/API implementation plan after the verification baseline is green.
   - Unlocks: better run/job demos, debugging, and future reliability work.
   - Effort/risk: small-to-medium docs reconciliation; medium implementation risk due schema/migration/job lifecycle changes.

3. **Artifact verification/enrichment/diff-summary ideas from `explore/dynamic-worker`**
   - Pulled into: [docs/stranded-artifacts/dynamic-workers-opportunities.md](./docs/stranded-artifacts/dynamic-workers-opportunities.md)
   - Action: harvest success webhook, artifact verification, metadata enrichment, and backup diff summary ideas; re-check the runtime mechanism before implementation.
   - Unlocks: stronger live-demo proof after an upload and a more credible "queryable backups" story.
   - Effort/risk: low as planning notes; medium/high implementation risk due R2 scanning, GitHub rate limits, and new Cloudflare runtime assumptions.

4. **Extracted landing-page asset structure from `feat/landing-page`**
   - Salvage externalized `src/landing/*`, design brief, Worker text-module import pattern, and Wrangler text rules.
   - Unlocks: maintainable homepage instead of a giant inline HTML string in `src/index.ts`.
   - Effort/risk: 0.5-1 day; risk is product-copy overclaim and Wrangler text-module compatibility.

5. **Alternate landing concepts from `feat/landing-page-2`**
   - Use as design reference only; extract one concept if product positioning changes.
   - Unlocks: more visual/copy options, not core demo functionality.
   - Effort/risk: low as reference; high if merged due old branch base and dependency/config churn.

Drop / cleanup candidates: `claude/review-plan-O8OqK`, `feat/cli`, and the pruned remote refactor branches are already integrated or gone. Do not resurrect them.

## Stranded artifact action index

Canonical index: [docs/stranded-artifacts/README.md](./docs/stranded-artifacts/README.md)

Use that index as the handoff into future planning. It intentionally keeps the
salvaged branch material separate from active implementation plans:

- Native git client / restore storage direction: [docs/stranded-artifacts/native-git-client.md](./docs/stranded-artifacts/native-git-client.md)
- Backup observability / job events / stale-job diagnosis: [docs/stranded-artifacts/backup-observability.md](./docs/stranded-artifacts/backup-observability.md)
- Dynamic Worker-adjacent verification, enrichment, success webhooks, and diff summaries: [docs/stranded-artifacts/dynamic-workers-opportunities.md](./docs/stranded-artifacts/dynamic-workers-opportunities.md)

These notes are planning inputs, not current product claims and not accepted
implementation specs. Convert them into fresh `plans/00x-*` slices only after
checking current code and dependencies.

## What works today

- Dependencies: root and container frozen installs were verified earlier in this review session with `bun install --frozen-lockfile`; tracked Git state remained clean. Not rerun after fetch because code did not change.
- Typecheck: `./node_modules/.bin/tsc --noEmit` passes.
- Tests: `bun run test` passes with 3 test files and 24 tests.
- Lint/check: `bun run check` fails on one current issue: `test/env.d.ts:3:9 lint/style/noNamespace` for `declare namespace Cloudflare`.
- Entrypoint: `src/index.ts` is the Worker entrypoint. It serves public `/`, public `/health`, authenticated admin routes (`/repos`, `/jobs`, `/runs`), internal callback routes (`/internal/jobs`), a queue handler, and a scheduled handler.
- Container entrypoint: `container/server.ts` exposes `/health`, debug endpoints, and `POST /backup`; its backup path clones, archives, hashes, uploads to R2, fetches metadata, uploads metadata, and calls back.
- CLI: `cli/index.ts` registers `health`, `repos`, `jobs`, and `runs` commands through `citty`.
- GitHub Actions has a manual Pullfrog workflow at `.github/workflows/pullfrog.yml`.

## Scaffolded / stubbed / missing

- No `build` script exists; build health beyond TypeScript checking is UNKNOWN without running Wrangler deploy/build behavior.
- No `typecheck` script exists even though direct `tsc --noEmit` passes.
- No verification CI exists for typecheck/lint/test; the only workflow on `main` is the manual Pullfrog agent workflow.
- No automated test covers the real container clone/tar/S3-upload/callback loop.
- Public `/health/debug/connectivity` and `/health/debug/container-jobs` are unauthenticated. This is already captured by `plans/003-auth-gate-debug-endpoints.md`.
- No repo-scoped latest/artifacts endpoints, no download endpoint, no restore endpoint, no verify CLI.
- Landing page is inline in `src/index.ts` and makes claims beyond the product's implemented UX.

## Cloudflare resources

No `alchemy.run.ts` exists; IaC is `wrangler.jsonc`.

| Resource | Binding/config | Bound? | Actually used? | Notes |
|---|---|---:|---:|---|
| Worker | `name: gitcask`, `main: src/index.ts` | yes | yes | Hono app, queue consumer, scheduled handler. Deployment status UNKNOWN. |
| D1 | `DB`, `gitcask-db`, id `8fb034f5-4e68-4f19-adad-b112ec374e00` | yes | yes | Stores repos, jobs, runs, artifacts. Remote DB/migrations UNKNOWN. |
| R2 | `BUCKET`, `gitcask-backups` | yes | partly | Worker writes `latest.json`, deletes/list objects, retention cleanup. Container uploads tar/metadata via S3 credentials, not the binding. Remote bucket UNKNOWN. |
| Queue | `JOB_QUEUE`, `gitcask-jobs` producer/consumer | yes | yes | Manual/scheduled triggers enqueue; consumer dispatches and retries. |
| Durable Object | `CONTAINER`, class `BackupContainer` | yes | yes | DO wrapper starts/monitors Cloudflare Container and proxies port 8788. |
| Container | `gitcask-backup`, `./container/Dockerfile`, basic instance | yes | yes in code | Needs live Cloudflare Container support; deployed status UNKNOWN. |
| Cron | `*/5 * * * *` | yes | yes | Scheduler and retention cleanup run on tick. |
| KV | none | no | no | No KV binding found. |
| Alchemy | none | no | no | No Alchemy IaC file found. |

## End-to-end backup path

1. **Auth:** working for admin routes through static bearer `ADMIN_TOKEN`; debug health subroutes are missing auth.
2. **Repo registration:** implemented; `POST /repos` validates required fields, interval, duplicate owner/name, and GitHub API access using `GITHUB_PAT`. Live GitHub access UNKNOWN without secrets/network.
3. **Manual trigger:** implemented; creates queued job and sends `JOB_QUEUE` message. Tested at API level.
4. **Scheduled trigger:** implemented; cron checks due repos, uses GitHub `pushed_at` change detection, enqueues jobs, advances `next_run_at`. Tested for scheduler/change-detection cases.
5. **Queue dispatch:** implemented; consumer marks job running, calls `dispatch`, and records/retries dispatch failures.
6. **Container clone/mirror:** implemented-but-unverified; container runs `git clone --mirror` with GitHub PAT. Requires real GitHub access and container internet.
7. **Archive/hash:** implemented-but-unverified in real flow; container creates `.tar.gz` and SHA-256.
8. **R2 storage:** implemented-but-unverified with real R2; container uploads tarball and metadata JSON via S3 API credentials.
9. **Callback / records:** implemented; callback marks completed, inserts run/artifact, writes `latest.json`, updates repo timestamps. Full loop unverified.
10. **Listing:** partial; `GET /repos/:id/runs` and `GET /runs/:id` exist, with artifacts only visible through run detail.
11. **Restore/download:** missing.

## Encryption vs. mirroring

The code implements mirroring, not application-level encryption. The backup artifact is a tarred `git clone --mirror` directory uploaded to R2 with a SHA-256 checksum. There is no encryption key model, encrypt/decrypt function, KMS integration, client-side encryption, encrypted metadata path, or restore-time decryption path. Any storage-layer encryption Cloudflare provides is outside this application's code and should not be marketed as gitcask encrypted backup.

Honest positioning today: automated GitHub mirror backups to R2 with job/run metadata.

## Claims-vs-reality delta

- README says full end-to-end testing requires real R2 credentials and GitHub PAT. Accurate; current automated tests do not prove clone/upload.
- README says production resource creation includes updating a placeholder database id, but current `wrangler.jsonc` contains a concrete D1 id. Whether that remote resource exists and is migrated is UNKNOWN.
- Landing says "GitHub backups with a filesystem interface" and "Back up GitHub like a filesystem." Reality: no filesystem interface; only REST routes and path-like R2 object keys.
- Landing says "durable, queryable backup targets." Reality: job/run metadata is queryable; stored artifacts are not first-class queryable by repo yet.
- Landing says "restores can be reasoned about..." Reality: no restore or download path exists.
- Landing advertises `curl -fsSL https://install.gitcask.dev | sh`. Reality: no installer implementation in this repo.
- `PLAN.md` says repo deletion enqueues async cleanup. Reality: current `DELETE /repos/:id` synchronously deletes D1 rows and lists/deletes R2 objects inside the request.
- `PLAN.md` says no download API in v1. Reality: still true.

## Blockers to a live demo

- Secrets/env vars: `ADMIN_TOKEN`, `GITHUB_PAT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `WORKER_URL`; optional `WEBHOOK_URL`.
- Cloudflare resources: D1 DB with migrations, R2 bucket, Queue, Worker, Durable Object migration, Cloudflare Container build/runtime.
- Prove `WORKER_URL` is reachable from the container for progress/completion callbacks.
- Prove hard-coded bucket name `gitcask-backups` matches the deployed R2 bucket and S3 credentials.
- Fix or explicitly waive current `bun run check` failure before presenting a green repo.
- Auth-gate `/health/debug/*` before public demo exposure.
- Perform one real backup against a tiny repo to validate PAT scope, container internet, S3 upload, callback, D1 records, and R2 objects.
- Add or seed a way to show the result without opening R2 manually: at minimum latest/artifact listing.

## Candidate demo paths

1. **Current architecture live backup demo**
   - Scope: deploy current Worker/Container, configure secrets, add one tiny repo, trigger backup, poll job/runs, show `GET /runs/:id` artifact key and verify object in R2 with external tooling.
   - Effort: medium.
   - Branch salvage that helps: backup observability docs can guide what to watch, but no branch code is required.

2. **Backup visibility demo**
   - Scope: implement the narrow plan 009 read surface (`/repos/:id/latest`, `/repos/:id/artifacts`, CLI display), then run or seed a backup and show stored artifacts through gitcask itself.
   - Effort: medium.
   - Branch salvage that helps: `spike/native-git-client` informs future restore/download choices; Dynamic Worker spike contributes artifact verification ideas.

3. **Control-plane + positioning demo**
   - Scope: local/Miniflare control-plane demo for auth, repo CRUD, scheduling/change detection, job/runs API, paired with a cleaned-up landing page that avoids restore/encryption/filesystem overclaims.
   - Effort: small-to-medium.
   - Branch salvage that helps: `feat/landing-page` externalized assets/design brief; `feat/landing-page-2` alternate concepts as reference only.

## Cleanup confirmation

Subagents inspected five detached worktrees under `/private/tmp/gitcask-review-v2`. All five review worktrees were removed with `git worktree remove --force`, `git worktree prune` was run, and `git worktree list` now shows only `/Users/nbbaier/Code/gitcask` on `main`.
