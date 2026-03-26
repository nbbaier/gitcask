# Dynamic Workers Opportunities for Gitcask

Cloudflare's [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/) spin up
V8 isolates at runtime in milliseconds with controlled bindings and network access. They're
not a replacement for the container-based backup pipeline (which needs native git and a real
filesystem), but they're a natural fit for the lightweight tasks that surround it:
validation, verification, notification, and enrichment.

Each idea below is independent — they can be adopted incrementally without touching the core
backup flow.

---

## 1. Pre-Backup Repo Validation

**Problem:** The scheduler blindly enqueues jobs. If a repo has been deleted, renamed, or the
PAT has lost access, the container boots, clones, fails, retries 3 times, and only then
reports failure. That's ~15 minutes of wasted compute per bad repo.

**Dynamic Worker approach:** Before enqueuing (or in the queue consumer before dispatching to
the container), spin up a minimal worker that makes a single GitHub API call:

```js
// Passed as the dynamic worker's code
export default {
  async validate(owner, repo, pat) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `token ${pat}` },
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (res.status === 403) return { ok: false, reason: "pat_revoked" };
    return { ok: true };
  },
};
```

- Millisecond startup, single HTTP call, no container needed
- On failure: skip the job, mark it failed immediately, fire webhook
- **Integration point:** `scheduler.ts` (before `env.JOB_QUEUE.send()`) or
  `consumer.ts` (before container dispatch)

---

## 2. Change Detection / Skip-If-Unchanged

**Problem:** Every scheduled interval triggers a full `git clone --mirror` even if the repo
hasn't changed. For repos with infrequent commits, this wastes bandwidth and storage.

**Dynamic Worker approach:** Before dispatching the backup, check if the repo has changed
since the last snapshot:

```js
export default {
  async hasChanged(owner, repo, pat, lastKnownSha) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      { headers: { Authorization: `token ${pat}` } }
    );
    const refs = await res.json();
    // Hash all ref SHAs into a single fingerprint
    const fingerprint = await computeHash(
      refs.map((r) => `${r.ref}:${r.object.sha}`).sort().join("\n")
    );
    return { changed: fingerprint !== lastKnownSha, fingerprint };
  },
};
```

- Store the ref fingerprint on each successful run (in the artifact record or `latest.json`)
- If unchanged: skip the backup, update `next_run_at`, log it
- Dramatically reduces R2 storage and GitHub API load for stable repos
- **Integration point:** `consumer.ts` before container dispatch, new `ref_fingerprint`
  column on `runs` table

---

## 3. Backup Completion Webhooks

**Problem:** Only failures fire webhooks. External monitoring systems can't distinguish
"backups are succeeding" from "the system is down and not even trying." Silence is ambiguous.

**Dynamic Worker approach:** After a successful backup, spin up a worker to deliver a
richly-formatted webhook with retry logic:

```js
export default {
  async notify(webhookUrl, payload) {
    const maxAttempts = 3;
    for (let i = 0; i < maxAttempts; i++) {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return { delivered: true, attempt: i + 1 };
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
    return { delivered: false, attempts: maxAttempts };
  },
};
```

Payload could include:
```json
{
  "event": "backup.completed",
  "repo": { "owner": "org", "name": "repo" },
  "artifact": { "sha256": "...", "size_bytes": 12345678 },
  "duration_ms": 8432,
  "timestamp": "2026-03-26T12:00:00Z"
}
```

This also fixes the current fire-and-forget webhook delivery — the dynamic worker can retry
without blocking the callback handler.

- **Integration point:** `callback.ts` success path (line ~162), called via `waitUntil()`

---

## 4. Artifact Integrity Verification

**Problem:** Once an artifact lands in R2, nothing ever checks it again. Bit rot, incomplete
uploads, or R2 issues could silently corrupt backups. You'd only discover this when you need
to restore — the worst possible time.

**Dynamic Worker approach:** Periodically spin up a worker that spot-checks artifacts:

```js
export default {
  async verify(artifactKey, expectedSha256, env) {
    const obj = await env.BUCKET.get(artifactKey);
    if (!obj) return { ok: false, reason: "missing" };

    const digest = new crypto.DigestStream("SHA-256");
    await obj.body.pipeTo(digest);
    const hash = [...new Uint8Array(await digest.digest)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return { ok: hash === expectedSha256, actual: hash, expected: expectedSha256 };
  },
};
```

- Pass the R2 bucket binding directly via `env` — no S3 credentials needed
- Run on the retention schedule, checking a random sample or oldest-unchecked artifacts
- On mismatch: fire alert webhook, optionally trigger a fresh backup
- **Integration point:** New service alongside `retention.ts`, runs on the 5-min cron

---

## 5. Post-Backup Metadata Enrichment

**Problem:** The container captures basic GitHub metadata, but there's a lot more context
that's useful for auditing and compliance: branch protection rules, open vulnerability
alerts, collaborator count, license info, language breakdown.

**Dynamic Worker approach:** After a successful backup, enrich the metadata sidecar:

```js
export default {
  async enrich(owner, repo, pat, metadataKey, env) {
    const headers = { Authorization: `token ${pat}` };
    const [protection, vulns, languages] = await Promise.all([
      fetch(`https://api.github.com/repos/${owner}/${repo}/branches/main/protection`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/vulnerability-alerts`, { headers }),
      fetch(`https://api.github.com/repos/${owner}/${repo}/languages`, { headers }),
    ]);

    const enriched = {
      branch_protection: protection.ok ? await protection.json() : null,
      vulnerability_alerts_enabled: vulns.status !== 404,
      languages: languages.ok ? await languages.json() : null,
      enriched_at: new Date().toISOString(),
    };

    // Merge into existing metadata sidecar
    const existing = await env.BUCKET.get(metadataKey);
    const metadata = existing ? await existing.json() : {};
    await env.BUCKET.put(metadataKey, JSON.stringify({ ...metadata, ...enriched }));

    return { ok: true };
  },
};
```

- Runs in parallel with the main callback — doesn't slow down job completion
- R2 binding passed directly, GitHub calls use `globalOutbound`
- **Integration point:** `callback.ts` success path, via `waitUntil()`

---

## 6. R2 Orphan Cleanup

**Problem:** When a repo is deleted, R2 cleanup happens via `waitUntil()` and is
fire-and-forget. If it fails partway through (network blip, timeout), orphaned objects
accumulate silently.

**Dynamic Worker approach:** Periodically scan R2 for prefixes that don't match any active
repo:

```js
export default {
  async cleanup(activeRepoPrefixes, env) {
    const orphans = [];
    let cursor;
    do {
      const listed = await env.BUCKET.list({ cursor, delimiter: "/" });
      for (const prefix of listed.delimitedPrefixes) {
        if (!activeRepoPrefixes.includes(prefix)) {
          orphans.push(prefix);
        }
      }
      cursor = listed.cursor;
    } while (cursor);

    for (const prefix of orphans) {
      // Delete all objects under orphaned prefix
      let objCursor;
      do {
        const objects = await env.BUCKET.list({ prefix, cursor: objCursor });
        await Promise.all(objects.objects.map((o) => env.BUCKET.delete(o.key)));
        objCursor = objects.cursor;
      } while (objCursor);
    }

    return { orphansFound: orphans.length, prefixes: orphans };
  },
};
```

- R2 binding via `env`, no credentials needed
- Run hourly or daily — doesn't need to be frequent
- **Integration point:** Separate cron trigger or extended retention service

---

## 7. Backup Diff Summary

**Problem:** You know *that* a backup happened, but not *what changed*. For audit and
compliance, it's useful to know: how many commits were added, which branches changed, whether
tags were created or deleted.

**Dynamic Worker approach:** After a successful backup, compare the current ref list against
the previous one:

```js
export default {
  async diff(owner, repo, pat, previousRefs) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      { headers: { Authorization: `token ${pat}` } }
    );
    const currentRefs = await res.json();

    const prev = new Map(previousRefs.map((r) => [r.ref, r.sha]));
    const curr = new Map(currentRefs.map((r) => [r.ref, r.object.sha]));

    const added = [...curr.keys()].filter((k) => !prev.has(k));
    const removed = [...prev.keys()].filter((k) => !curr.has(k));
    const changed = [...curr.entries()]
      .filter(([k, v]) => prev.has(k) && prev.get(k) !== v)
      .map(([k]) => k);

    return { added, removed, changed, total_refs: curr.size };
  },
};
```

- Store ref snapshots in the metadata sidecar or a new `ref_snapshots` table
- Surface in the API via `GET /repos/:id/runs/:id/changes`
- **Integration point:** `callback.ts` success path, via `waitUntil()`

---

## Architecture Pattern

All of these follow the same shape: the main Worker orchestrates, the Dynamic Worker
executes a focused task with minimal bindings.

```
┌─────────────────────────────────────────────────────────┐
│  Main Worker (control plane)                            │
│                                                         │
│  Scheduler ──▶ Queue ──▶ Consumer ──▶ Container (git)   │
│                  │                        │              │
│                  ▼                        ▼              │
│         ┌──────────────┐        ┌──────────────┐        │
│         │ Dynamic Worker│        │ Dynamic Worker│       │
│         │ Pre-validate  │        │ Enrich / Diff │       │
│         └──────────────┘        └──────────────┘        │
│                                                         │
│  Retention ──▶ ┌──────────────┐                         │
│                │ Dynamic Worker│                         │
│                │ Verify / Clean│                         │
│                └──────────────┘                         │
└─────────────────────────────────────────────────────────┘
```

The key principle: **containers do heavy I/O (git clone, tar, upload), Dynamic Workers do
lightweight coordination (API calls, checksums, webhooks).** Each Dynamic Worker gets only
the bindings it needs — R2 for verification, outbound network for GitHub API calls, nothing
for pure compute tasks.
