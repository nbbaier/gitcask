import { and, eq, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { generateId, now } from "../lib/id.ts";
import type { Env, QueueMessage } from "../types.ts";
import { checkScheduledBackup } from "./change-detection.ts";
import { markFailedByDeadline } from "./job-lifecycle.ts";

function advanceNextRunAt(
  repo: { interval_minutes: number },
  fromMs = Date.now()
): string {
  return new Date(fromMs + repo.interval_minutes * 60 * 1000).toISOString();
}

export async function handleScheduledEvent(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const timestamp = now();

  console.log("[scheduler] cron tick");

  const dueRepos = await db
    .select()
    .from(schema.repos)
    .where(
      and(
        eq(schema.repos.enabled, true),
        lte(schema.repos.next_run_at, timestamp)
      )
    );

  console.log("[scheduler] repos due for backup", { count: dueRepos.length });

  for (const repo of dueRepos) {
    const decision = await checkScheduledBackup(repo, env.GITHUB_PAT);

    if (decision.action === "skip") {
      await db
        .update(schema.repos)
        .set({
          next_run_at: advanceNextRunAt(repo),
          updated_at: timestamp,
        })
        .where(eq(schema.repos.id, repo.id));

      console.log("[scheduler] skipped unchanged repo", {
        repo: `${repo.owner}/${repo.name}`,
        pushed_at: decision.pushed_at,
      });
      continue;
    }

    console.log("[scheduler] backup needed", {
      repo: `${repo.owner}/${repo.name}`,
      reason: decision.reason,
    });

    const jobId = generateId();
    const idempotencyKey = `schedule_${repo.id}_${Date.now()}`;

    await db.insert(schema.jobs).values({
      id: jobId,
      repo_id: repo.id,
      trigger_source: "schedule",
      idempotency_key: idempotencyKey,
      status: "queued",
      attempt: 1,
      deadline_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      created_at: timestamp,
      updated_at: timestamp,
    });

    const message: QueueMessage = {
      job_id: jobId,
      repo_id: repo.id,
      idempotency_key: idempotencyKey,
      attempt: 1,
      trigger_source: "schedule",
    };

    await env.JOB_QUEUE.send(message);

    console.log("[scheduler] enqueued job", {
      job_id: jobId,
      repo: `${repo.owner}/${repo.name}`,
    });

    await db
      .update(schema.repos)
      .set({ next_run_at: advanceNextRunAt(repo), updated_at: timestamp })
      .where(eq(schema.repos.id, repo.id));
  }

  const staleJobs = await db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.status, "running"),
        lte(schema.jobs.deadline_at, timestamp)
      )
    );

  if (staleJobs.length > 0) {
    console.log("[scheduler] found stale jobs past deadline", {
      count: staleJobs.length,
    });
  }

  for (const job of staleJobs) {
    console.log("[scheduler] marking stale job failed", {
      job_id: job.id,
      deadline_at: job.deadline_at,
    });
    const result = await markFailedByDeadline(db, job.id);
    if (!result.ok) {
      console.log("[scheduler] could not mark stale job failed", {
        job_id: job.id,
        reason: result.reason,
      });
    }
  }
}
