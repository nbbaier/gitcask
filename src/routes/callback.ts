import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { generateId, now } from "../lib/id.ts";
import type { ContainerCallbackPayload, Env } from "../types.ts";

const app = new Hono<{ Bindings: Env }>();

// POST /internal/jobs/:id/complete - Container callback
app.post("/:id/complete", async (c) => {
  const jobId = c.req.param("id");
  const payload = await c.req.json<ContainerCallbackPayload>();

  const db = drizzle(c.env.DB);

  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status !== "running") {
    return c.json({ error: "Job is not in running state" }, 409);
  }

  const timestamp = now();

  if (payload.success) {
    // Update job to completed
    await db
      .update(schema.jobs)
      .set({ status: "completed", updated_at: timestamp })
      .where(eq(schema.jobs.id, jobId));

    // Create run record
    const runId = generateId();
    await db.insert(schema.runs).values({
      id: runId,
      repo_id: job.repo_id,
      job_id: jobId,
      status: "completed",
      started_at: job.created_at,
      finished_at: timestamp,
      created_at: timestamp,
    });

    // Create artifact record
    if (payload.sha256 && payload.size_bytes && payload.object_key) {
      await db.insert(schema.artifacts).values({
        id: generateId(),
        run_id: runId,
        repo_id: job.repo_id,
        object_key: payload.object_key,
        sha256: payload.sha256,
        size_bytes: payload.size_bytes,
        created_at: timestamp,
      });
    }

    // Update latest.json in R2
    const [repo] = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, job.repo_id));

    if (repo && payload.object_key) {
      const latestKey = `repos/${repo.owner}/${repo.name}/latest.json`;
      await c.env.BUCKET.put(
        latestKey,
        JSON.stringify({
          run_id: runId,
          object_key: payload.object_key,
          metadata_key: payload.metadata_key,
          sha256: payload.sha256,
          size_bytes: payload.size_bytes,
          timestamp,
        })
      );
    }

    return c.json({ status: "completed" });
  }
  // Handle failure
  const maxRetries = 4; // initial + 3 retries
  const attempt = job.attempt;

  if (attempt < maxRetries) {
    // Retry: update attempt count, re-enqueue with backoff
    const nextAttempt = attempt + 1;
    const backoffMs = 2 ** attempt * 1000; // 2s, 4s, 8s

    await db
      .update(schema.jobs)
      .set({
        status: "queued",
        attempt: nextAttempt,
        deadline_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        updated_at: timestamp,
      })
      .where(eq(schema.jobs.id, jobId));

    await c.env.JOB_QUEUE.send(
      {
        job_id: jobId,
        repo_id: job.repo_id,
        idempotency_key: job.idempotency_key,
        attempt: nextAttempt,
        trigger_source: job.trigger_source,
      },
      { delaySeconds: Math.ceil(backoffMs / 1000) }
    );

    return c.json({ status: "retrying", attempt: nextAttempt });
  }
  // Final failure
  await db
    .update(schema.jobs)
    .set({ status: "failed", updated_at: timestamp })
    .where(eq(schema.jobs.id, jobId));

  // Create failed run record
  await db.insert(schema.runs).values({
    id: generateId(),
    repo_id: job.repo_id,
    job_id: jobId,
    status: "failed",
    started_at: job.created_at,
    finished_at: timestamp,
    error: payload.error ?? "Unknown error",
    created_at: timestamp,
  });

  // Fire webhook
  if (c.env.WEBHOOK_URL) {
    const [repo] = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, job.repo_id));

    if (repo) {
      const { fireWebhook } = await import("../lib/webhook.ts");
      await fireWebhook(c.env.WEBHOOK_URL, {
        event: "backup.failed",
        repo: { id: repo.id, owner: repo.owner, name: repo.name },
        job_id: jobId,
        attempts: maxRetries,
        error: payload.error ?? "Unknown error",
        timestamp,
      });
    }
  }

  return c.json({ status: "failed" });
});

export default app;
