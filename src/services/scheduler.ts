import { drizzle } from "drizzle-orm/d1";
import { eq, and, lte } from "drizzle-orm";
import * as schema from "../db/schema.ts";
import { generateId, now } from "../lib/id.ts";
import type { Env, QueueMessage } from "../types.ts";

export async function handleScheduledEvent(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const timestamp = now();

  // Find repos due for backup
  const dueRepos = await db
    .select()
    .from(schema.repos)
    .where(
      and(
        eq(schema.repos.enabled, true),
        lte(schema.repos.next_run_at, timestamp),
      ),
    );

  for (const repo of dueRepos) {
    const jobId = generateId();
    const idempotencyKey = `schedule_${repo.id}_${Date.now()}`;

    // Create job
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

    // Enqueue
    const message: QueueMessage = {
      job_id: jobId,
      repo_id: repo.id,
      idempotency_key: idempotencyKey,
      attempt: 1,
      trigger_source: "schedule",
    };

    await env.JOB_QUEUE.send(message);

    // Advance next_run_at
    const nextRun = new Date(
      Date.now() + repo.interval_minutes * 60 * 1000,
    ).toISOString();

    await db
      .update(schema.repos)
      .set({ next_run_at: nextRun, updated_at: timestamp })
      .where(eq(schema.repos.id, repo.id));
  }

  // Check for stale running jobs (past deadline)
  const staleJobs = await db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.status, "running"),
        lte(schema.jobs.deadline_at, timestamp),
      ),
    );

  for (const job of staleJobs) {
    // Treat as failed callback
    await db
      .update(schema.jobs)
      .set({ status: "failed", updated_at: timestamp })
      .where(eq(schema.jobs.id, job.id));

    await db.insert(schema.runs).values({
      id: generateId(),
      repo_id: job.repo_id,
      job_id: job.id,
      status: "failed",
      started_at: job.created_at,
      finished_at: timestamp,
      error: "Job exceeded deadline without callback",
      created_at: timestamp,
    });
  }
}
