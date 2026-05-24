import { and, eq } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
// biome-ignore lint/performance/noNamespaceImport: schema is consumed as a namespace
import * as schema from "../db/schema.ts";
import { generateId, now } from "../lib/id.ts";

type DB = DrizzleD1Database;

const MAX_ATTEMPTS = 4;
const DEADLINE_MS = 15 * 60 * 1000;
const retryBackoffMs = (attempt: number): number => 2 ** attempt * 1000;

const computeDeadline = (fromMs = Date.now()): string =>
  new Date(fromMs + DEADLINE_MS).toISOString();

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
      startedAt: string;
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

  return {
    ok: true,
    runId,
    repoId: job.repo_id,
    startedAt: job.created_at,
    finishedAt: timestamp,
  };
}

export type FailureOutcome =
  | {
      kind: "retry";
      nextAttempt: number;
      delayMs: number;
      repoId: string;
      idempotencyKey: string;
      triggerSource: "schedule" | "manual";
    }
  | { kind: "gave-up"; runId: string; repoId: string; attempts: number };

export type RecordFailureResult =
  | { ok: true; outcome: FailureOutcome }
  | NotFound
  | WrongStatus<"not-running">;

export async function recordFailure(
  db: DB,
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

    return {
      ok: true,
      outcome: {
        kind: "retry",
        nextAttempt,
        delayMs: retryBackoffMs(job.attempt),
        repoId: job.repo_id,
        idempotencyKey: job.idempotency_key,
        triggerSource: job.trigger_source,
      },
    };
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

  const runId = generateId();
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
      runId,
      repoId: job.repo_id,
      attempts: MAX_ATTEMPTS,
    },
  };
}

export type MarkFailedByDeadlineResult =
  | { ok: true; runId: string }
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

  const runId = generateId();
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

  return { ok: true, runId };
}

export type CancelResult =
  | { ok: true; runId: string }
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

  const runId = generateId();
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

  return { ok: true, runId };
}
