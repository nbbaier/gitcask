import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { fireWebhook } from "../lib/webhook.ts";
import { markRunning, recordFailure } from "../services/job-lifecycle.ts";
import type { ContainerRequest, Env, QueueMessage } from "../types.ts";

export async function handleQueueMessage(
  message: Message<QueueMessage>,
  env: Env
): Promise<void> {
  const { job_id, repo_id, idempotency_key } = message.body;
  const db = drizzle(env.DB);

  console.log("[queue] received message", { job_id, repo_id, idempotency_key });

  const transition = await markRunning(db, job_id, idempotency_key);
  if (!transition.ok) {
    console.log("[queue] skipping job", { job_id, reason: transition.reason });
    message.ack();
    return;
  }

  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repo_id));

  if (!repo) {
    console.log("[queue] skipping job — repo not found", { job_id, repo_id });
    message.ack();
    return;
  }

  console.log("[queue] job marked running", {
    job_id,
    repo: `${repo.owner}/${repo.name}`,
  });

  const containerPayload: ContainerRequest = {
    job_id,
    owner: repo.owner,
    repo: repo.name,
    pat: env.GITHUB_PAT,
    r2_credentials: {
      access_key_id: env.R2_ACCESS_KEY_ID?.trim() ?? "",
      secret_access_key: env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
      endpoint: env.R2_ENDPOINT?.trim() ?? "",
      bucket: "gitcask-backups",
    },
    object_key_prefix: `repos/${repo.owner}/${repo.name}/snapshots/`,
    callback_url: `${env.WORKER_URL}/internal/jobs/${job_id}/complete`,
    progress_url: `${env.WORKER_URL}/internal/jobs/${job_id}/progress`,
    callback_token: env.ADMIN_TOKEN,
  };

  try {
    console.log("[queue] dispatching to container", {
      job_id,
      repo: `${repo.owner}/${repo.name}`,
    });
    const id = env.CONTAINER.idFromName("backup");
    const stub = env.CONTAINER.get(id);
    const res = await stub.fetch("http://container/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(containerPayload),
    });

    if (!res.ok && res.status !== 202) {
      throw new Error(`Container returned ${res.status}`);
    }
    console.log("[queue] container accepted job", {
      job_id,
      status: res.status,
    });
  } catch (err) {
    const errorMsg = `Container dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[queue] container dispatch failed", {
      job_id,
      error: errorMsg,
    });

    const failure = await recordFailure(db, job_id, errorMsg);
    if (!failure.ok) {
      console.error("[queue] could not record dispatch failure", {
        job_id,
        reason: failure.reason,
      });
      message.ack();
      return;
    }

    if (failure.outcome.kind === "retry") {
      await env.JOB_QUEUE.send(
        {
          job_id,
          repo_id,
          idempotency_key,
          attempt: failure.outcome.nextAttempt,
          trigger_source: message.body.trigger_source,
        },
        { delaySeconds: Math.ceil(failure.outcome.delayMs / 1000) }
      );
      console.log("[queue] dispatch failure — retry scheduled", {
        job_id,
        attempt: failure.outcome.nextAttempt,
      });
    } else if (env.WEBHOOK_URL) {
      await fireWebhook(env.WEBHOOK_URL, {
        event: "backup.failed",
        repo: { id: repo.id, owner: repo.owner, name: repo.name },
        job_id,
        attempts: failure.outcome.attempts,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  message.ack();
}
