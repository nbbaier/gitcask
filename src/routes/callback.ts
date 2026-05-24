import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { generateId, now } from "../lib/id.ts";
import { fireWebhook } from "../lib/webhook.ts";
import type {
  FailureOutcome,
  MarkCompletedResult,
} from "../services/job-lifecycle.ts";
import { markCompleted, recordFailure } from "../services/job-lifecycle.ts";
import type { ContainerCallbackPayload, Env, JobStage } from "../types.ts";

const app = new Hono<{ Bindings: Env }>();

// POST /internal/jobs/:id/progress - Container stage update
app.post("/:id/progress", async (c) => {
  const jobId = c.req.param("id");
  const body = await c.req.json<{ stage: unknown }>();
  const validStages: JobStage[] = [
    "cloning",
    "archiving",
    "hashing",
    "uploading",
    "fetching_metadata",
    "uploading_metadata",
  ];
  const stage = body.stage as JobStage;

  console.log("[progress] received", { job_id: jobId, stage });

  if (!(stage && validStages.includes(stage))) {
    console.log("[progress] rejected — invalid stage", {
      job_id: jobId,
      stage,
    });
    return c.json({ error: "Invalid stage" }, 400);
  }

  const db = drizzle(c.env.DB);

  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) {
    console.log("[progress] rejected — job not found", { job_id: jobId });
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status !== "running") {
    console.log("[progress] rejected — job not running", {
      job_id: jobId,
      status: job.status,
    });
    return c.json({ error: "Job is not in running state" }, 409);
  }

  const timestamp = now();
  await db
    .update(schema.jobs)
    .set({ stage, stage_updated_at: timestamp, updated_at: timestamp })
    .where(eq(schema.jobs.id, jobId));

  console.log("[progress] stage updated", { job_id: jobId, stage });
  return c.json({ status: "updated", stage });
});

type DB = ReturnType<typeof drizzle>;

async function recordSuccessfulBackup(
  db: DB,
  env: Env,
  result: Extract<MarkCompletedResult, { ok: true }>,
  payload: ContainerCallbackPayload
): Promise<void> {
  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, result.repoId));

  if (!repo) {
    return;
  }

  if (payload.sha256 && payload.size_bytes && payload.object_key) {
    await db.insert(schema.artifacts).values({
      id: generateId(),
      run_id: result.runId,
      repo_id: repo.id,
      object_key: payload.object_key,
      sha256: payload.sha256,
      size_bytes: payload.size_bytes,
      created_at: result.finishedAt,
    });
  }

  if (!payload.object_key) {
    return;
  }

  const latestKey = `repos/${repo.owner}/${repo.name}/latest.json`;
  await env.BUCKET.put(
    latestKey,
    JSON.stringify({
      run_id: result.runId,
      object_key: payload.object_key,
      metadata_key: payload.metadata_key,
      sha256: payload.sha256,
      size_bytes: payload.size_bytes,
      timestamp: result.finishedAt,
    })
  );

  await db
    .update(schema.repos)
    .set({
      last_pushed_at: payload.pushed_at ?? repo.last_pushed_at,
      last_backup_at: result.finishedAt,
      updated_at: result.finishedAt,
    })
    .where(eq(schema.repos.id, repo.id));
}

async function reportPermanentFailure(
  db: DB,
  env: Env,
  jobId: string,
  outcome: Extract<FailureOutcome, { kind: "gave-up" }>,
  error: string
): Promise<void> {
  if (!env.WEBHOOK_URL) {
    return;
  }
  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, outcome.repoId));
  if (!repo) {
    return;
  }
  await fireWebhook(env.WEBHOOK_URL, {
    event: "backup.failed",
    repo: { id: repo.id, owner: repo.owner, name: repo.name },
    job_id: jobId,
    attempts: outcome.attempts,
    error,
    timestamp: new Date().toISOString(),
  });
}

// POST /internal/jobs/:id/complete - Container callback
app.post("/:id/complete", async (c) => {
  const jobId = c.req.param("id");
  const payload = await c.req.json<ContainerCallbackPayload>();

  console.log("[callback] received", {
    job_id: jobId,
    success: payload.success,
    error: payload.error,
  });

  const db = drizzle(c.env.DB);

  if (payload.success) {
    const result = await markCompleted(db, jobId);
    if (!result.ok) {
      console.log("[callback] rejected", {
        job_id: jobId,
        reason: result.reason,
      });
      const status = result.reason === "not-found" ? 404 : 409;
      return c.json({ error: result.reason }, status);
    }

    console.log("[callback] job completed", {
      job_id: jobId,
      run_id: result.runId,
      object_key: payload.object_key,
      size_bytes: payload.size_bytes,
    });

    await recordSuccessfulBackup(db, c.env, result, payload);
    return c.json({ status: "completed" });
  }

  // Failure path
  const error = payload.error ?? "Unknown error";
  const failure = await recordFailure(db, jobId, error);
  if (!failure.ok) {
    console.log("[callback] rejected", {
      job_id: jobId,
      reason: failure.reason,
    });
    const status = failure.reason === "not-found" ? 404 : 409;
    return c.json({ error: failure.reason }, status);
  }

  if (failure.outcome.kind === "retry") {
    const [job] = await db
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, jobId));

    if (job) {
      await c.env.JOB_QUEUE.send(
        {
          job_id: jobId,
          repo_id: job.repo_id,
          idempotency_key: job.idempotency_key,
          attempt: failure.outcome.nextAttempt,
          trigger_source: job.trigger_source,
        },
        { delaySeconds: Math.ceil(failure.outcome.delayMs / 1000) }
      );
    }

    console.log("[callback] job retrying", {
      job_id: jobId,
      attempt: failure.outcome.nextAttempt,
      delay_ms: failure.outcome.delayMs,
    });
    return c.json({ status: "retrying", attempt: failure.outcome.nextAttempt });
  }

  console.log("[callback] job failed permanently", {
    job_id: jobId,
    attempts: failure.outcome.attempts,
    error,
  });

  await reportPermanentFailure(db, c.env, jobId, failure.outcome, error);

  return c.json({ status: "failed" });
});

export default app;
