import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
// biome-ignore lint/performance/noNamespaceImport: schema is consumed as a namespace
import * as schema from "../db/schema.ts";
import type { Env, QueueMessage } from "../types.ts";

type DB = DrizzleD1Database;
type JobQueue = Env["JOB_QUEUE"];
type TriggerSource = QueueMessage["trigger_source"];

const MAX_ATTEMPTS = 4;
const DEADLINE_MS = 15 * 60 * 1000;
const retryBackoffMs = (attempt: number): number => 2 ** attempt * 1000;

const computeDeadline = (fromMs = Date.now()): string =>
  new Date(fromMs + DEADLINE_MS).toISOString();

const now = (): string => new Date().toISOString();

export async function enqueueJob(
  db: DB,
  queue: JobQueue,
  repoId: string,
  triggerSource: TriggerSource
): Promise<string> {
  const jobId = crypto.randomUUID();
  const timestamp = now();
  const message: QueueMessage = {
    job_id: jobId,
    repo_id: repoId,
    idempotency_key: `${triggerSource}_${repoId}_${Date.now()}`,
    attempt: 1,
    trigger_source: triggerSource,
  };

  await db.insert(schema.jobs).values({
    id: jobId,
    repo_id: repoId,
    trigger_source: triggerSource,
    idempotency_key: message.idempotency_key,
    status: "queued",
    attempt: 1,
    deadline_at: computeDeadline(),
    created_at: timestamp,
    updated_at: timestamp,
  });

  await queue.send(message);
  return jobId;
}

interface NotFound {
  ok: false;
  reason: "not-found";
}

interface WrongStatus<S extends string> {
  ok: false;
  reason: S;
}

export type MarkRunningResult =
  | { ok: true }
  | NotFound
  | WrongStatus<"not-queued">
  | WrongStatus<"idempotency-mismatch">
  | WrongStatus<"attempt-mismatch">;

export async function markRunning(
  db: DB,
  jobId: string,
  expectedIdempotencyKey: string,
  expectedAttempt: number
): Promise<MarkRunningResult> {
  const timestamp = now();

  // Conditional UPDATE: only transitions if all preconditions still hold.
  // Closes the SELECT-then-UPDATE race a delayed duplicate queue message
  // could otherwise exploit.
  const updated = await db
    .update(schema.jobs)
    .set({
      status: "running",
      deadline_at: computeDeadline(),
      updated_at: timestamp,
    })
    .where(
      and(
        eq(schema.jobs.id, jobId),
        eq(schema.jobs.status, "queued"),
        eq(schema.jobs.idempotency_key, expectedIdempotencyKey),
        eq(schema.jobs.attempt, expectedAttempt)
      )
    )
    .returning({ id: schema.jobs.id });

  if (updated.length > 0) {
    return { ok: true };
  }

  // Transition didn't happen — diagnose by reading current state.
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) {
    return { ok: false, reason: "not-found" };
  }
  if (job.status !== "queued") {
    return { ok: false, reason: "not-queued" };
  }
  if (job.idempotency_key !== expectedIdempotencyKey) {
    return { ok: false, reason: "idempotency-mismatch" };
  }
  return { ok: false, reason: "attempt-mismatch" };
}

export type MarkCompletedResult =
  | {
      ok: true;
      runId: string;
      repoId: string;
      finishedAt: string;
    }
  | NotFound
  | WrongStatus<"not-running">;

export async function markCompleted(
  db: DB,
  jobId: string
): Promise<MarkCompletedResult> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) {
    return { ok: false, reason: "not-found" };
  }
  if (job.status !== "running") {
    return { ok: false, reason: "not-running" };
  }

  const timestamp = now();
  await db
    .update(schema.jobs)
    .set({
      status: "completed",
      stage: null,
      stage_updated_at: null,
      deadline_at: null,
      updated_at: timestamp,
    })
    .where(eq(schema.jobs.id, jobId));

  const runId = crypto.randomUUID();
  await db.insert(schema.runs).values({
    id: runId,
    repo_id: job.repo_id,
    job_id: jobId,
    status: "completed",
    started_at: job.created_at,
    finished_at: timestamp,
    created_at: timestamp,
  });

  return {
    ok: true,
    runId,
    repoId: job.repo_id,
    finishedAt: timestamp,
  };
}

export type FailureOutcome =
  | { kind: "retry"; nextAttempt: number; delayMs: number }
  | { kind: "gave-up"; repoId: string; attempts: number };

export type RecordFailureResult =
  | { ok: true; outcome: FailureOutcome }
  | NotFound
  | WrongStatus<"not-running">;

// On retry, the job is re-enqueued with backoff before returning.
export async function recordFailure(
  db: DB,
  queue: JobQueue,
  jobId: string,
  error: string
): Promise<RecordFailureResult> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) {
    return { ok: false, reason: "not-found" };
  }

  if (job.status !== "running") {
    return { ok: false, reason: "not-running" };
  }

  const timestamp = now();

  if (job.attempt < MAX_ATTEMPTS) {
    const nextAttempt = job.attempt + 1;
    await db
      .update(schema.jobs)
      .set({
        status: "queued",
        stage: null,
        stage_updated_at: null,
        attempt: nextAttempt,
        deadline_at: computeDeadline(),
        updated_at: timestamp,
      })
      .where(eq(schema.jobs.id, jobId));

    const delayMs = retryBackoffMs(job.attempt);
    await queue.send(
      {
        job_id: jobId,
        repo_id: job.repo_id,
        idempotency_key: job.idempotency_key,
        attempt: nextAttempt,
        trigger_source: job.trigger_source,
      },
      { delaySeconds: Math.ceil(delayMs / 1000) }
    );

    return { ok: true, outcome: { kind: "retry", nextAttempt, delayMs } };
  }

  await db
    .update(schema.jobs)
    .set({
      status: "failed",
      stage: null,
      stage_updated_at: null,
      deadline_at: null,
      updated_at: timestamp,
    })
    .where(eq(schema.jobs.id, jobId));

  const runId = crypto.randomUUID();
  await db.insert(schema.runs).values({
    id: runId,
    repo_id: job.repo_id,
    job_id: jobId,
    status: "failed",
    started_at: job.created_at,
    finished_at: timestamp,
    error,
    created_at: timestamp,
  });

  return {
    ok: true,
    outcome: {
      kind: "gave-up",
      repoId: job.repo_id,
      attempts: MAX_ATTEMPTS,
    },
  };
}

export type MarkFailedByDeadlineResult =
  | { ok: true }
  | NotFound
  | WrongStatus<"not-running">;

export async function markFailedByDeadline(
  db: DB,
  jobId: string
): Promise<MarkFailedByDeadlineResult> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) {
    return { ok: false, reason: "not-found" };
  }
  if (job.status !== "running") {
    return { ok: false, reason: "not-running" };
  }

  const timestamp = now();
  await db
    .update(schema.jobs)
    .set({
      status: "failed",
      stage: null,
      stage_updated_at: null,
      deadline_at: null,
      updated_at: timestamp,
    })
    .where(eq(schema.jobs.id, jobId));

  const runId = crypto.randomUUID();
  await db.insert(schema.runs).values({
    id: runId,
    repo_id: job.repo_id,
    job_id: jobId,
    status: "failed",
    started_at: job.created_at,
    finished_at: timestamp,
    error: "Job exceeded deadline without callback",
    created_at: timestamp,
  });

  return { ok: true };
}

export type CancelResult =
  | { ok: true }
  | NotFound
  | WrongStatus<"already-completed">
  | WrongStatus<"already-failed">;

export async function cancel(db: DB, jobId: string): Promise<CancelResult> {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId));

  if (!job) {
    return { ok: false, reason: "not-found" };
  }
  if (job.status === "completed") {
    return { ok: false, reason: "already-completed" };
  }
  if (job.status === "failed") {
    return { ok: false, reason: "already-failed" };
  }

  const timestamp = now();
  await db
    .update(schema.jobs)
    .set({
      status: "failed",
      stage: null,
      stage_updated_at: null,
      deadline_at: null,
      updated_at: timestamp,
    })
    .where(eq(schema.jobs.id, jobId));

  const runId = crypto.randomUUID();
  await db.insert(schema.runs).values({
    id: runId,
    repo_id: job.repo_id,
    job_id: jobId,
    status: "failed",
    started_at: job.created_at,
    finished_at: timestamp,
    error: "Manually cancelled",
    created_at: timestamp,
  });

  return { ok: true };
}
