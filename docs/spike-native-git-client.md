# Spike: replacing the container with a native Worker git client
## What we currently ship to R2
The container produces, per backup run:

1. `<prefix>/<timestamp>_<job_id>.tar.gz` — a gzipped tar of a `git clone --mirror` working tree (i.e. a bare repo: `HEAD`, `refs/`, `packed-refs`, `objects/pack/*.pack`, `objects/pack/*.idx`, config). SHA-256 stored alongside.
  
2. `<prefix>/<timestamp>_<job_id>_metadata.json` — GitHub API metadata (description, topics, default branch, etc.).
  

Restore semantics today: download tarball, `tar xzf`, you have a usable bare repo you can `git clone` from locally.

**Whatever replaces the container must produce something restorable to that same fidelity** — every ref, every reachable object — or we have to explicitly accept a format change and update restore docs.
## The core insight from git-on-cloudflare
A git "mirror" over the wire is essentially a single packfile plus a ref list. `git clone --mirror` is just smart-HTTP-v2 `git-upload-pack` with `want <oid>` for every advertised ref, and the response body **is** a packfile. The container's filesystem dance (`git clone` → `tar`) is convenience, not necessity.

So the question reduces to: **can a Worker speak smart-HTTP-v2 to github.com, capture the resulting packfile, and store something restorable in R2?**

The answer is yes. The design space is in _what we store canonically in R2_ and _when we materialize the user-facing tar.gz_ — those are now two separate decisions, not one.
## Framing: canonical storage vs. download artifact
The container today conflates two things: the **canonical backup data** (everything needed to reconstruct the repo) and the **user-facing download artifact** (a tar.gz of a bare mirror). Splitting them gives us more flexibility:

- **Canonical storage** = whatever R2 layout we pick. This is what every backup writes. It needs to be cheap, streaming-friendly, and complete.
  
- **Download artifact** = the tar.gz we expose to users for "give me my backup as a single file." Doesn't have to be the same shape as canonical storage; can be derived from it.
  

We've decided we want to **keep tar.gz as the download artifact** (it's the "no gitcask required" disaster-recovery shape — anyone with the file + `tar` + `git` can restore even if gitcask itself is gone). The remaining choice is _when_ we materialize it. See "Tar.gz materialization" below.

* * *
## Option A — Store the raw packfile + refs sidecar (canonical, recommended)
Worker flow:

1. `GET github.com/<owner>/<repo>.git/info/refs?service=git-upload-pack` — parse ref advertisement (pkt-line).
  
2. `POST .../git-upload-pack` with `want <oid>` for each non-peeled ref + capabilities + `done`.
  
3. Stream response body straight into an R2 multipart upload, computing SHA-256 with `crypto.DigestStream` inline.
  
4. Write a small JSON sidecar with the ref list (`{ "refs": { "refs/heads/main": "<oid>", ... }, "HEAD": "refs/heads/main" }`).
  

R2 layout:

```
<prefix>/<ts>_<job>.pack          # raw packfile from GitHub
<prefix>/<ts>_<job>.refs.json     # ref → oid mapping + HEAD
<prefix>/<ts>_<job>_metadata.json # unchanged GitHub API metadata
```

**Pros:** smallest amount of Worker code (~200–300 lines). No delta resolution, no `.idx` generation at backup time, no tar. Streaming end-to-end → no memory pressure, no CPU-time concerns. Pack is exactly what GitHub sent.

**Cons:** raw pack + refs.json isn't directly usable as a `git clone` source without one of: (a) the on-demand tar.gz generator described below, (b) the gitcask-served `git clone` endpoint described in the Bonus section, or (c) a small restore script. End users don't see the canonical format — they see the tar.gz download or the `git clone` URL.
## Tar.gz materialization: at-backup vs. on-demand
Given canonical storage is pack + refs, the question is when we build the tar.gz that users actually download.
### B1 — Materialize at backup time (eager)
After receiving the pack: generate `.idx`, assemble a tar with `HEAD`/`packed-refs`/`config`/`objects/pack/*`, gzip-stream into R2. Same R2 path as today (`<ts>_<job>.tar.gz`).

**Pros:** tarball SHA-256 recorded per run exactly as today. Download is a single `R2 GET`. Backwards-compatible artifact path.

**Cons:** every backup pays the `.idx` generation cost — the CPU-bound, memory-bounded step that breaks on very large repos. If `.idx` generation fails, the backup itself fails even though the canonical data (pack + refs) is already in R2 and intact.
### B2 — Materialize on demand (lazy, recommended)
Backup writes only pack + refs.json + metadata.json. A new Worker route — `GET /repos/<id>/runs/<run_id>/download.tar.gz` — generates the tarball at request time: read pack from R2, generate `.idx`, stream tar+gzip back to the client. Optionally cache the result back to R2 on first download so the cost is paid once.

**Pros:**

- `.idx` cost is paid only for runs users actually download, not every scheduled backup.
  
- A repo too big for `.idx` generation still backs up successfully — it just can't be downloaded as tar.gz (but can still be `git clone`'d from gitcask; see Bonus).
  
- Decouples "backup succeeded" from "tarball generated" — fewer ways for a backup to fail.
  

**Cons:**

- Per-run tarball SHA-256 isn't computed at backup time. If we want it recorded in D1, compute it on first materialization and store back.
  
- Cold downloads are slower than today (one-time `.idx` cost + tar streaming). Cached downloads after the first are as fast as today.
  
- More moving parts: a download route, a cache policy, an invalidation story (probably "never invalidate; backups are immutable").
  

Recommendation: **B2.** The "backup never fails because `.idx` generation OOMed" property is worth the cold-download cost and the small SHA-256 ergonomics tax.
## Option C — `isomorphic-git` in the Worker
Use `isomorphic-git` with a memory- or R2-backed FS shim to run `clone({ noCheckout: true, depth: ... })`.

**Pros:** least code we write ourselves. Library is mature.

**Cons:** git-on-cloudflare's maintainers explicitly removed `isomorphic-git` for scalability — it indexes the full pack through an in-memory FS and OOMs on large repos. We'd inherit that ceiling. Also pulls in a non-trivial dependency footprint. Probably fine for the median repo, painful for the 95th percentile.

Worth keeping as a fallback if Option A/B turn out to be much more work than expected, but not the recommended path.
## Option D — Skip the git protocol entirely: GitHub tarball endpoint
GitHub exposes `GET /repos/{owner}/{repo}/tarball/{ref}` which returns a gzipped tar of the **working tree** at a ref.

**Pros:** trivial Worker code — it's just `fetch` → R2 multipart. No git protocol at all.

**Cons:** **this is not a backup of the repo.** It captures one ref's working tree, no history, no other branches, no tags. Useful as a separate "source snapshot" feature but it cannot replace the mirror backup. Mentioning it only to rule it out explicitly so we don't rediscover it later.
## Option E — Hybrid: Worker fetches, Workflow orchestrates, container deleted
Regardless of A/B/C, the Workflow/Queue orchestration layer (job lifecycle, retries, progress callbacks, D1 writes) stays exactly as it is. The container is replaced by either:

- (a) a direct `fetch` from the existing Worker that today _dispatches_ to the container, or
  
- (b) a new Cloudflare Workflow step that does the pack fetch.
  

(b) is appealing because Workflows give us free durability around the fetch — if the Worker dies mid-pack-download, the step retries. With (a) we'd want our own checkpoint/resume on the R2 multipart upload. Worth a separate decision once we know which artifact format we're committing to.

* * *
## Constraints to verify before committing
These are the things most likely to kill the approach; flagging them so we test them in the spike, not in production.

- **CPU time.** Workers have a CPU-time budget (defaults 30s, max 300s on paid plans). Pack fetch is mostly I/O wait, which doesn't count against CPU. But `.idx` generation (Option B) is CPU-bound — for a 500 MB pack with deep delta chains, we need to verify it fits. git-on-cloudflare runs with `cpu_ms: 300000`.
  
- **Subrequest limit.** Workers cap outbound subrequests per invocation (50 on free, 1000 on paid). One pack fetch is one subrequest; safe.
  
- **Memory.** A Worker has 128 MB. Streaming the pack to R2 doesn't buffer it, so the pack size itself doesn't matter. `.idx` generation in Option B needs to hold the offset table — ~24 bytes × object count. A repo with 1M objects = 24 MB, fine. A repo with 10M objects = 240 MB, **does not fit**. Need a rough survey of expected repo sizes.
  
- **R2 multipart minimums.** Parts must be ≥ 5 MiB except the last. git-on-cloudflare uses 8 MiB. Fine.
  
- **Auth.** Same PAT we use today, sent as HTTP Basic to github.com (`Authorization: Basic base64(x-access-token:<pat>)`). No new credential surface.
  
- **Shallow / partial clone.** GitHub supports `shallow` and `filter` capabilities in v2. Probably not relevant for backup (we want full history) but worth knowing as a fallback for repos that exceed the memory bound.
  
## Recommended next step (still no implementation)
1. Pick a target repo for the spike — ideally one we already back up successfully via the container, so we can compare.
  
2. Read git-on-cloudflare's `src/worker/git/core/pktline.ts` and `src/worker/git/receive/r2Upload.ts` end-to-end. ~30 min. These two files determine whether Option A is really ~250 lines or more.
  
3. Commit to **Option A (canonical) + B2 (lazy tar.gz)** unless something in step 2 surprises us. Materializing the tarball on demand keeps the existing download UX without making `.idx` generation a backup-blocking step.
  
4. Then, and only then, branch to implementation.
  
## Bonus: a second restore path — `git clone` straight from gitcask
Now that we have two restore paths to design — the tar.gz download (preserved via B2) and a native `git clone` URL — it's worth calling out the second one explicitly. It's not the _primary_ restore path; the tar.gz remains the "no gitcask required" disaster-recovery artifact. This is a convenience layer on top.

Since we store the raw pack + refs in R2, gitcask already has everything needed to serve git Smart HTTP v2 _back out_ to a client. That's exactly what git-on-cloudflare does, except instead of receiving packs from clients, we'd be serving the packs we already have. **Same pkt-line code, same pack-streaming primitives, just reversed.**

Concretely, add two routes to the existing Worker:

- `GET /<owner>/<repo>.git/info/refs?service=git-upload-pack` — look up the latest successful run in D1, read its `.refs.json` from R2, format as a v2 ref advertisement.
  
- `POST /<owner>/<repo>.git/git-upload-pack` — parse the client's `want`s, then stream the latest `.pack` straight from R2 back to the client.
  

End-user UX becomes:

```sh
git clone https://gitcask.example.com/nbbaier/gitcask.git
```

…and you have the latest backup as a working repo. No download/expand/local-clone dance.
### Scope to keep this honest
- **Full clones only, not fetches/pulls.** A real git server has to compute a "thin pack" for the client's `have <oid>` list. That requires walking the object graph — expensive, and exactly the kind of work git-on-cloudflare builds a SQLite-backed DO to do. For a backup product, "git clone of a snapshot" is the 95% use case; pull/fetch is not.
  
- **Latest snapshot by default.** Optionally `?at=<timestamp>` or path scheme like `/<owner>/<repo>.git@<job_id>/...` for historical snapshots. Defer until needed.
  
- **Auth.** The serve side needs its own auth model — probably the existing `ADMIN_TOKEN` via Basic auth (which git natively understands), or per-repo tokens. Worth its own short note before implementing.
  
- **Multiple packs over time?** Each backup writes a fresh full pack today. If we ever switch to incremental (storing only new objects per run), serving gets harder. Keep the current "each backup = one self-contained pack" invariant and serve only the most recent one.
  
### Why this is essentially free once canonical storage is pack+refs
Implementation cost: maybe **+150 lines** on top of the backup path.

- pkt-line code: already written (the backup-side client uses it to parse refs ad / write wants).
  
- Pack streaming from R2: an `R2 GET` body piped to the response body. The Worker doesn't even need to parse the pack — it's just bytes.
  
- Ref ad formatting: a few `for` loops over `.refs.json`.
  
- The hardest part is auth + URL routing, both of which we already have a framework for.
  

Note that the eager-tarball alternative (B1) wouldn't extend naturally to `git clone` — you'd have to unpack a tarball in the Worker on every clone request, which defeats the streaming model. Another vote for pack+refs as canonical.
### Updated R2 layout (sketch)
```
<prefix>/<ts>_<job>.pack
<prefix>/<ts>_<job>.refs.json
<prefix>/<ts>_<job>_metadata.json
<prefix>/latest -> <ts>_<job>            # symlink-equivalent, or a D1 pointer
```

R2 doesn't have symlinks, so "latest" is either: (a) a D1 column `last_successful_object_key` on the repo row, or (b) a fixed `latest.refs.json` / `latest.pack` written as a copy/redirect on each successful run. (a) is simpler and we already have D1.

* * *
## Open questions
- ~~Are there any existing or planned restore consumers that assume the~~ `tar.gz` ~~shape?~~ **Resolved (c1): only user is you, but we still want to keep the tar.gz as the downloadable artifact for disaster-recovery portability. The canonical storage shape (pack + refs) changes; the user-facing download artifact does not.**
  
- ~~Do we want to keep the per-run~~ `metadata.json` ~~exactly as-is?~~ **Resolved (c2): yes, keep as-is.**
  
- Should the spike also re-evaluate the orchestration layer (Workflows vs. current Queue+DO), or keep that out of scope? Recommend keeping it out of scope — one variable at a time.
  
- **New:** is the `git clone` serve endpoint in scope for the same spike, or a follow-up? Recommend: in scope as a _design_ concern (so we don't lock in an R2 layout that makes it hard later), but build the backup path first and the serve path second.
