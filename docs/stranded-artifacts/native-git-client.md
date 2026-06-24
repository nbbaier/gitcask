# Native Git Client Artifact

Source branch: `spike/native-git-client`

Status: salvage note. This preserves the storage/restore design idea without
committing the project to replacing the container.

## Core Question

The container currently creates a `tar.gz` of a `git clone --mirror` directory.
Could a Worker speak Git smart HTTP directly, fetch the repository packfile
from GitHub, and store a complete backup in R2 without a container filesystem?

The branch's answer was: probably yes, but the important decision is storage
format, not just runtime.

## Current Artifact Shape

Today the container intends to write:

- `<prefix>/<timestamp>_<job_id>.tar.gz`
- `<prefix>/<timestamp>_<job_id>_metadata.json`

The tarball is easy to restore with ordinary tools: download, `tar xzf`, then
clone from the extracted bare repo locally.

## Key Insight

A Git mirror over smart HTTP is effectively:

- a packfile containing all reachable objects for the advertised refs
- a ref list mapping refs and `HEAD`

The container's `git clone --mirror` then tar step is convenient, but it is
not the only possible canonical representation.

## Recommended Canonical Format From The Spike

Store packfile plus refs as the canonical backup:

```text
<prefix>/<timestamp>_<job_id>.pack
<prefix>/<timestamp>_<job_id>.refs.json
<prefix>/<timestamp>_<job_id>_metadata.json
```

Backup flow sketch:

1. Fetch GitHub ref advertisement.
2. Request `git-upload-pack` for every non-peeled ref.
3. Stream the response body into R2 multipart upload.
4. Compute SHA-256 while streaming.
5. Write refs sidecar and metadata sidecar.

## Tarball As Download Artifact

The spike recommends keeping `tar.gz` as the disaster-recovery download shape,
but not necessarily as canonical storage.

Two options:

- **Eager tarball:** materialize tarball during every backup.
- **Lazy tarball:** store pack + refs during backup, then generate/cache the
  tarball only when someone downloads it.

The spike favors lazy tarball generation because backup success should not
depend on CPU-heavy `.idx` generation or tar materialization.

## Why This Matters For Plan 009

The archived
[restore/read API spike](./outdated/plans/009-restore-read-api-spike.md) focuses
on exposing the artifacts gitcask already writes. Its read surface remains a
Phase 1 input, but the newer roadmap selects Cloudflare Artifacts for the v1
clone-serving engine. Treat the questions below as fallback-engine research,
not decisions that block the Phase 1 read surface:

- Is `tar.gz` the canonical artifact or just the user-facing artifact?
- Does each backup need a precomputed tarball checksum?
- Can a restore/download route tolerate cold materialization?
- Should the R2 layout preserve a future `git clone` endpoint?

## Future `git clone` Endpoint Idea

If canonical storage is pack + refs, gitcask could eventually expose a
read-only Git smart HTTP endpoint backed by R2:

```text
GET  /<owner>/<repo>.git/info/refs?service=git-upload-pack
POST /<owner>/<repo>.git/git-upload-pack
```

That would allow:

```sh
git clone https://gitcask.example.com/owner/repo.git
```

Scope constraints from the spike:

- latest snapshot by default
- full clone only, not incremental fetch/pull
- separate auth design required
- keep each backup self-contained

## Constraints To Verify

- Worker CPU time during `.idx` generation
- 128 MB Worker memory ceiling
- R2 multipart upload behavior and minimum part sizes
- GitHub smart HTTP protocol details
- expected object counts for target repositories
- whether Workflows should orchestrate the direct pack fetch

## Action Guidance

Do not replace the container as part of the first backup-visibility pass.
Use this artifact to keep restore/download decisions from baking in a storage
layout that blocks a packfile-native future.
