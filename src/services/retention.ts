import { drizzle } from "drizzle-orm/d1";
import { eq, lt, and, desc } from "drizzle-orm";
import * as schema from "../db/schema.ts";
import type { Env } from "../types.ts";

const MIN_TIME_DAYS = 7;
const MAX_COUNT = 30;
const RUN_METADATA_TTL_DAYS = 180;

export async function runRetentionCleanup(env: Env): Promise<void> {
  const db = drizzle(env.DB);

  // Get all repos
  const allRepos = await db.select().from(schema.repos);

  for (const repo of allRepos) {
    // Get all artifacts for this repo, ordered by creation date desc
    const allArtifacts = await db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.repo_id, repo.id))
      .orderBy(desc(schema.artifacts.created_at));

    const minTimeThreshold = new Date(
      Date.now() - MIN_TIME_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Keep all within min time window, then cap at MAX_COUNT beyond that
    const toKeep = new Set<string>();
    const toDelete: typeof allArtifacts = [];

    for (const artifact of allArtifacts) {
      if (artifact.created_at >= minTimeThreshold) {
        toKeep.add(artifact.id);
      } else if (toKeep.size < MAX_COUNT) {
        toKeep.add(artifact.id);
      } else {
        toDelete.push(artifact);
      }
    }

    // Delete old artifacts from R2 and D1
    for (const artifact of toDelete) {
      await env.BUCKET.delete(artifact.object_key);
      // Also delete the metadata sidecar
      const metadataKey = artifact.object_key.replace(
        ".tar.gz",
        "_metadata.json",
      );
      await env.BUCKET.delete(metadataKey);
      await db
        .delete(schema.artifacts)
        .where(eq(schema.artifacts.id, artifact.id));
    }
  }

  // TTL cleanup: remove old run metadata
  const ttlThreshold = new Date(
    Date.now() - RUN_METADATA_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db
    .delete(schema.runs)
    .where(lt(schema.runs.created_at, ttlThreshold));

  // Clean up old completed/failed jobs without runs
  await db
    .delete(schema.jobs)
    .where(
      and(
        lt(schema.jobs.created_at, ttlThreshold),
        eq(schema.jobs.status, "completed"),
      ),
    );

  await db
    .delete(schema.jobs)
    .where(
      and(
        lt(schema.jobs.created_at, ttlThreshold),
        eq(schema.jobs.status, "failed"),
      ),
    );
}
