import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import type { Env } from "../types.ts";

const MIN_TIME_DAYS = 7;
const MAX_COUNT = 30;
const RETENTION_REPO_BATCH_SIZE = 25;
const RETENTION_ARTIFACT_BATCH_SIZE = 100;
const RUN_METADATA_TTL_DAYS = 180;
const RUN_METADATA_BATCH_SIZE = 100;

async function deleteArtifact(env: Env, objectKey: string): Promise<void> {
  await env.BUCKET.delete(objectKey);
  await env.BUCKET.delete(objectKey.replace(".tar.gz", "_metadata.json"));
}

export async function runRetentionCleanup(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const minTimeThreshold = new Date(
    Date.now() - MIN_TIME_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // Bound work per cron tick so retention stays predictable as data grows.
  const reposWithExpiredArtifacts = await db
    .select({ repo_id: schema.artifacts.repo_id })
    .from(schema.artifacts)
    .where(lt(schema.artifacts.created_at, minTimeThreshold))
    .groupBy(schema.artifacts.repo_id)
    .limit(RETENTION_REPO_BATCH_SIZE);

  for (const { repo_id } of reposWithExpiredArtifacts) {
    const artifactsToDelete = await db
      .select()
      .from(schema.artifacts)
      .where(
        and(
          eq(schema.artifacts.repo_id, repo_id),
          lt(schema.artifacts.created_at, minTimeThreshold)
        )
      )
      .orderBy(desc(schema.artifacts.created_at))
      .offset(MAX_COUNT)
      .limit(RETENTION_ARTIFACT_BATCH_SIZE);

    for (const artifact of artifactsToDelete) {
      await deleteArtifact(env, artifact.object_key);
      await db
        .delete(schema.artifacts)
        .where(eq(schema.artifacts.id, artifact.id));
    }
  }

  // TTL cleanup: remove old run metadata and their artifacts
  const ttlThreshold = new Date(
    Date.now() - RUN_METADATA_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const staleRuns = await db
    .select({ id: schema.runs.id })
    .from(schema.runs)
    .where(lt(schema.runs.created_at, ttlThreshold))
    .orderBy(asc(schema.runs.created_at))
    .limit(RUN_METADATA_BATCH_SIZE);

  if (staleRuns.length > 0) {
    const staleRunIds = staleRuns.map((r) => r.id);

    // Delete artifacts (R2 + D1) for stale runs
    const orphanedArtifacts = await db
      .select()
      .from(schema.artifacts)
      .where(inArray(schema.artifacts.run_id, staleRunIds));

    for (const artifact of orphanedArtifacts) {
      await deleteArtifact(env, artifact.object_key);
    }

    if (orphanedArtifacts.length > 0) {
      await db
        .delete(schema.artifacts)
        .where(inArray(schema.artifacts.run_id, staleRunIds));
    }

    await db.delete(schema.runs).where(inArray(schema.runs.id, staleRunIds));
  }

  // Clean up old completed/failed jobs without runs
  await db
    .delete(schema.jobs)
    .where(
      and(
        lt(schema.jobs.created_at, ttlThreshold),
        eq(schema.jobs.status, "completed")
      )
    );

  await db
    .delete(schema.jobs)
    .where(
      and(
        lt(schema.jobs.created_at, ttlThreshold),
        eq(schema.jobs.status, "failed")
      )
    );
}
