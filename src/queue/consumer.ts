import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../db/schema.ts";
import { now } from "../lib/id.ts";
import type { ContainerRequest, Env, QueueMessage } from "../types.ts";

export async function handleQueueMessage(
  message: Message<QueueMessage>,
  env: Env
): Promise<void> {
  const { job_id, repo_id, idempotency_key } = message.body;
  const db = drizzle(env.DB);

  // Deduplicate: check if job still exists and is in queued state
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, job_id));

  if (!job || job.status !== "queued") {
    message.ack();
    return;
  }

  // Check idempotency key matches
  if (job.idempotency_key !== idempotency_key) {
    message.ack();
    return;
  }

  // Get repo details
  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repo_id));

  if (!repo) {
    message.ack();
    return;
  }

  // Mark job as running
  const timestamp = now();
  await db
    .update(schema.jobs)
    .set({
      status: "running",
      deadline_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      updated_at: timestamp,
    })
    .where(eq(schema.jobs.id, job_id));

  // Dispatch to container (async - container will call back)
  const containerPayload: ContainerRequest = {
    job_id,
    owner: repo.owner,
    repo: repo.name,
    pat: env.GITHUB_PAT,
    r2_credentials: {
      access_key_id: (
        (env as Record<string, string>).R2_ACCESS_KEY_ID ?? ""
      ).trim(),
      secret_access_key: (
        (env as Record<string, string>).R2_SECRET_ACCESS_KEY ?? ""
      ).trim(),
      endpoint: ((env as Record<string, string>).R2_ENDPOINT ?? "").trim(),
      bucket: "gitcask-backups",
    },
    object_key_prefix: `repos/${repo.owner}/${repo.name}/snapshots/`,
    callback_url: `${env.WORKER_URL}/internal/jobs/${job_id}/complete`,
    callback_token: env.ADMIN_TOKEN,
  };

  try {
    const res = await fetch(`${env.CONTAINER_URL}/backup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerPayload),
    });

    if (!res.ok && res.status !== 202) {
      throw new Error(`Container returned ${res.status}`);
    }
  } catch (err) {
    // Container dispatch failed - mark job back to queued for retry via callback
    console.error("Container dispatch failed", err);
    // Simulate a failed callback
    const callbackPayload = {
      job_id,
      success: false,
      error: `Container dispatch failed: ${err instanceof Error ? err.message : String(err)}`,
    };

    // Update job back to running so the callback handler can process it
    // (it's already running from above)
    try {
      await fetch(`${env.WORKER_URL}/internal/jobs/${job_id}/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.ADMIN_TOKEN}`,
        },
        body: JSON.stringify(callbackPayload),
      });
    } catch {
      // If even the self-callback fails, just fail the job directly
      await db
        .update(schema.jobs)
        .set({ status: "failed", updated_at: now() })
        .where(eq(schema.jobs.id, job_id));
    }
  }

  message.ack();
}
