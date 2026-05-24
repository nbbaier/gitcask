import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { fireWebhook } from "../lib/webhook.ts";
import { dispatch } from "../services/backup-dispatcher.ts";
import { markRunning, recordFailure } from "../services/job-lifecycle.ts";
import type { Env, QueueMessage } from "../types.ts";

export async function handleQueueMessage(
  message: Message<QueueMessage>,
  env: Env
): Promise<void> {
  const { job_id, repo_id, idempotency_key, attempt } = message.body;
  const db = drizzle(env.DB);

  console.log("[queue] received message", {
    job_id,
    repo_id,
    idempotency_key,
    attempt,
  });

  // Fetch repo before transitioning the job — a missing repo must leave
  // the job in `queued`, never strand it in `running` waiting for the
  // 15-minute deadline sweep to clean it up.
  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, repo_id));

  if (!repo) {
    console.log("[queue] skipping job — repo not found", { job_id, repo_id });
    message.ack();
    return;
  }

  const transition = await markRunning(db, job_id, idempotency_key, attempt);
  if (!transition.ok) {
    console.log("[queue] skipping job", { job_id, reason: transition.reason });
    message.ack();
    return;
  }

  console.log("[queue] dispatching to container", {
    job_id,
    repo: `${repo.owner}/${repo.name}`,
  });

  const result = await dispatch(job_id, repo, env);
  if (result.accepted) {
    console.log("[queue] container accepted job", { job_id });
    message.ack();
    return;
  }

  const errorMsg = `Container dispatch failed: ${result.error}`;
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

  message.ack();
}
