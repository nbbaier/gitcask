import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { runRetentionCleanup } from "../src/services/retention.ts";

// Helper to apply migrations
async function applyMigrations(db: D1Database) {
  const migration = `
    CREATE TABLE IF NOT EXISTS repos (
      id text PRIMARY KEY NOT NULL,
      owner text NOT NULL,
      name text NOT NULL,
      interval_minutes integer DEFAULT 60 NOT NULL,
      enabled integer DEFAULT 1 NOT NULL,
      next_run_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id text PRIMARY KEY NOT NULL,
      repo_id text NOT NULL,
      trigger_source text NOT NULL,
      idempotency_key text NOT NULL,
      status text NOT NULL,
      stage text,
      stage_updated_at text,
      attempt integer DEFAULT 1 NOT NULL,
      deadline_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id text PRIMARY KEY NOT NULL,
      repo_id text NOT NULL,
      job_id text NOT NULL,
      status text NOT NULL,
      started_at text NOT NULL,
      finished_at text,
      error text,
      created_at text NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      repo_id text NOT NULL,
      object_key text NOT NULL,
      sha256 text NOT NULL,
      size_bytes integer NOT NULL,
      created_at text NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    );
  `;

  for (const stmt of migration.split(";").filter((s) => s.trim())) {
    await db.prepare(stmt).run();
  }
}

function makeRequest(
  path: string,
  options: RequestInit = {},
  token = "test-admin-token"
): Request {
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return new Request(`http://localhost${path}`, {
    ...options,
    headers,
  });
}

describe("Gitcask API", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await applyMigrations(env.DB);
    // Clean tables between tests
    await env.DB.prepare("DELETE FROM artifacts").run();
    await env.DB.prepare("DELETE FROM runs").run();
    await env.DB.prepare("DELETE FROM jobs").run();
    await env.DB.prepare("DELETE FROM repos").run();
  });

  describe("GET /health", () => {
    it("returns ok without auth", async () => {
      const req = new Request("http://localhost/health");
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("ok");
    });
  });

  describe("Auth", () => {
    it("rejects requests without auth token", async () => {
      const req = makeRequest("/repos", { method: "GET" }, "");
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(401);
    });

    it("rejects requests with invalid token", async () => {
      const req = makeRequest("/repos", { method: "GET" }, "wrong-token");
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(401);
    });
  });

  describe("GET /repos", () => {
    it("returns empty list initially", async () => {
      const req = makeRequest("/repos");
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });
  });

  describe("PATCH /repos/:id", () => {
    it("returns 404 for nonexistent repo", async () => {
      const req = makeRequest("/repos/nonexistent", {
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("updates an existing repo", async () => {
      // Insert a repo directly
      const id = crypto.randomUUID();
      const ts = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO repos (id, owner, name, interval_minutes, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(id, "test-owner", "test-repo", 60, 1, ts, ts, ts)
        .run();

      const req = makeRequest(`/repos/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ interval_minutes: 30, enabled: false }),
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        interval_minutes: number;
        enabled: number;
      };
      expect(body.interval_minutes).toBe(30);
      expect(body.enabled).toBeFalsy();
    });
  });

  describe("DELETE /repos/:id", () => {
    it("returns 404 for nonexistent repo", async () => {
      const req = makeRequest("/repos/nonexistent", { method: "DELETE" });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("deletes an existing repo", async () => {
      const id = crypto.randomUUID();
      const ts = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO repos (id, owner, name, interval_minutes, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(id, "test-owner", "test-repo", 60, 1, ts, ts, ts)
        .run();

      const req = makeRequest(`/repos/${id}`, { method: "DELETE" });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      // Verify it's gone
      const check = await env.DB.prepare("SELECT * FROM repos WHERE id = ?")
        .bind(id)
        .first();
      expect(check).toBeNull();
    });
  });

  describe("POST /repos/:id/trigger", () => {
    it("returns 404 for nonexistent repo", async () => {
      const req = makeRequest("/repos/nonexistent/trigger", {
        method: "POST",
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });

    it("enqueues a manual job instead of dispatching it directly", async () => {
      const repoId = crypto.randomUUID();
      const ts = new Date().toISOString();

      await env.DB.prepare(
        "INSERT INTO repos (id, owner, name, interval_minutes, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(repoId, "test-owner", "test-repo", 60, 1, ts, ts, ts)
        .run();

      const req = makeRequest(`/repos/${repoId}/trigger`, {
        method: "POST",
      });
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(202);
      const body = (await res.json()) as { job_id: string; status: string };
      expect(body.status).toBe("queued");

      const job = await env.DB.prepare(
        "SELECT status, trigger_source, attempt FROM jobs WHERE id = ?"
      )
        .bind(body.job_id)
        .first<{ attempt: number; status: string; trigger_source: string }>();

      expect(job).toMatchObject({
        status: "queued",
        trigger_source: "manual",
        attempt: 1,
      });
    });
  });

  describe("GET /runs/:id", () => {
    it("returns 404 for nonexistent run", async () => {
      const req = makeRequest("/runs/nonexistent");
      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(404);
    });
  });

  describe("POST /internal/jobs/:id/complete", () => {
    it("handles successful backup callback", async () => {
      // Create a repo and job
      const repoId = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      const ts = new Date().toISOString();

      await env.DB.prepare(
        "INSERT INTO repos (id, owner, name, interval_minutes, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(repoId, "test-owner", "test-repo", 60, 1, ts, ts, ts)
        .run();

      await env.DB.prepare(
        "INSERT INTO jobs (id, repo_id, trigger_source, idempotency_key, status, attempt, deadline_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(jobId, repoId, "manual", "test-key", "running", 1, ts, ts, ts)
        .run();

      const req = makeRequest(`/internal/jobs/${jobId}/complete`, {
        method: "POST",
        body: JSON.stringify({
          job_id: jobId,
          success: true,
          sha256: "abc123",
          size_bytes: 1024,
          object_key: "repos/test-owner/test-repo/snapshots/test.tar.gz",
          metadata_key:
            "repos/test-owner/test-repo/snapshots/test_metadata.json",
        }),
      });

      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe("completed");

      // Verify job is completed
      const job = await env.DB.prepare("SELECT status FROM jobs WHERE id = ?")
        .bind(jobId)
        .first<{ status: string }>();
      expect(job?.status).toBe("completed");

      // Verify run was created
      const run = await env.DB.prepare(
        "SELECT status FROM runs WHERE job_id = ?"
      )
        .bind(jobId)
        .first<{ status: string }>();
      expect(run?.status).toBe("completed");

      // Verify artifact was created
      const artifact = await env.DB.prepare(
        "SELECT sha256, size_bytes FROM artifacts WHERE repo_id = ?"
      )
        .bind(repoId)
        .first<{ sha256: string; size_bytes: number }>();
      expect(artifact?.sha256).toBe("abc123");
      expect(artifact?.size_bytes).toBe(1024);

      // Verify latest.json was written to R2
      const latest = await env.BUCKET.get(
        "repos/test-owner/test-repo/latest.json"
      );
      expect(latest).not.toBeNull();
    });

    it("handles failed callback with retry", async () => {
      const repoId = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      const ts = new Date().toISOString();

      await env.DB.prepare(
        "INSERT INTO repos (id, owner, name, interval_minutes, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(repoId, "test-owner", "test-repo", 60, 1, ts, ts, ts)
        .run();

      await env.DB.prepare(
        "INSERT INTO jobs (id, repo_id, trigger_source, idempotency_key, status, attempt, deadline_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(jobId, repoId, "manual", "test-key", "running", 1, ts, ts, ts)
        .run();

      const req = makeRequest(`/internal/jobs/${jobId}/complete`, {
        method: "POST",
        body: JSON.stringify({
          job_id: jobId,
          success: false,
          error: "git clone failed",
        }),
      });

      const ctx = createExecutionContext();
      const res = await worker.fetch(req, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; attempt: number };
      expect(body.status).toBe("retrying");
      expect(body.attempt).toBe(2);

      // Verify job is back to queued with incremented attempt
      const job = await env.DB.prepare(
        "SELECT status, attempt FROM jobs WHERE id = ?"
      )
        .bind(jobId)
        .first<{ status: string; attempt: number }>();
      expect(job?.status).toBe("queued");
      expect(job?.attempt).toBe(2);
    });
  });

  describe("runRetentionCleanup", () => {
    it("keeps recent artifacts, preserves the 7-day boundary, and caps older ones at 30", async () => {
      const currentTime = new Date("2026-03-28T12:00:00.000Z");
      vi.useFakeTimers();
      vi.setSystemTime(currentTime);

      const repoId = crypto.randomUUID();
      const jobId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const ts = currentTime.toISOString();

      await env.DB.prepare(
        "INSERT INTO repos (id, owner, name, interval_minutes, enabled, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(repoId, "test-owner", "retention-repo", 60, 1, ts, ts, ts)
        .run();

      await env.DB.prepare(
        "INSERT INTO jobs (id, repo_id, trigger_source, idempotency_key, status, attempt, deadline_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(
          jobId,
          repoId,
          "manual",
          `retention-${repoId}`,
          "completed",
          1,
          ts,
          ts,
          ts
        )
        .run();

      await env.DB.prepare(
        "INSERT INTO runs (id, repo_id, job_id, status, started_at, finished_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
        .bind(runId, repoId, jobId, "completed", ts, ts, ts)
        .run();

      const repoPrefix = "repos/test-owner/retention-repo/snapshots";
      const retentionThreshold = new Date(
        currentTime.getTime() - 7 * 24 * 60 * 60 * 1000
      ).toISOString();
      const deletedObjectKey = `${repoPrefix}/delete-me.tar.gz`;
      const artifactRows = [
        {
          created_at: currentTime.toISOString(),
          object_key: `${repoPrefix}/recent.tar.gz`,
        },
        {
          created_at: retentionThreshold,
          object_key: `${repoPrefix}/boundary.tar.gz`,
        },
        ...Array.from({ length: 30 }, (_, index) => ({
          created_at: new Date(
            currentTime.getTime() - (8 + index) * 24 * 60 * 60 * 1000
          ).toISOString(),
          object_key: `${repoPrefix}/keep-${index}.tar.gz`,
        })),
        {
          created_at: new Date(
            currentTime.getTime() - 90 * 24 * 60 * 60 * 1000
          ).toISOString(),
          object_key: deletedObjectKey,
        },
      ];

      for (const artifact of artifactRows) {
        await env.DB.prepare(
          "INSERT INTO artifacts (id, run_id, repo_id, object_key, sha256, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
          .bind(
            crypto.randomUUID(),
            runId,
            repoId,
            artifact.object_key,
            "abc123",
            1024,
            artifact.created_at
          )
          .run();
        await env.BUCKET.put(artifact.object_key, "archive");
        await env.BUCKET.put(
          artifact.object_key.replace(".tar.gz", "_metadata.json"),
          "metadata"
        );
      }

      await runRetentionCleanup(env);

      const remainingArtifacts = await env.DB.prepare(
        "SELECT COUNT(*) as count FROM artifacts WHERE repo_id = ?"
      )
        .bind(repoId)
        .first<{ count: number }>();

      expect(remainingArtifacts?.count).toBe(32);

      const deletedArtifact = await env.DB.prepare(
        "SELECT id FROM artifacts WHERE object_key = ?"
      )
        .bind(deletedObjectKey)
        .first();
      expect(deletedArtifact).toBeNull();

      const deletedArchive = await env.BUCKET.get(deletedObjectKey);
      const deletedMetadata = await env.BUCKET.get(
        deletedObjectKey.replace(".tar.gz", "_metadata.json")
      );
      expect(deletedArchive).toBeNull();
      expect(deletedMetadata).toBeNull();

      const boundaryArtifact = await env.DB.prepare(
        "SELECT id FROM artifacts WHERE object_key = ?"
      )
        .bind(`${repoPrefix}/boundary.tar.gz`)
        .first();
      expect(boundaryArtifact).not.toBeNull();
    });
  });
});
