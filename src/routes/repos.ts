import { and, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { validateGitHubRepoAccess } from "../lib/github.ts";
import { generateId, now } from "../lib/id.ts";
import type { Env } from "../types.ts";

const app = new Hono<{ Bindings: Env }>();

// POST /repos - Create a new repo to back up
app.post("/", async (c) => {
  const body = await c.req.json<{
    owner: string;
    name: string;
    interval_minutes?: number;
  }>();

  if (!(body.owner && body.name)) {
    return c.json({ error: "owner and name are required" }, 400);
  }

  const interval = body.interval_minutes ?? 60;
  if (interval < 5) {
    return c.json({ error: "interval_minutes must be >= 5" }, 400);
  }

  // Check for duplicate
  const db = drizzle(c.env.DB);
  const [existing] = await db
    .select()
    .from(schema.repos)
    .where(
      and(eq(schema.repos.owner, body.owner), eq(schema.repos.name, body.name))
    );

  if (existing) {
    return c.json({ error: "Repo already exists", id: existing.id }, 409);
  }

  const ghAccess = await validateGitHubRepoAccess(
    body.owner,
    body.name,
    c.env.GITHUB_PAT
  );

  if (!ghAccess.ok) {
    return c.json(
      {
        error: `GitHub repo not accessible: ${ghAccess.status} ${ghAccess.statusText}`,
      },
      422
    );
  }

  const id = generateId();
  const timestamp = now();
  const nextRun = new Date(Date.now() + interval * 60 * 1000).toISOString();

  await db.insert(schema.repos).values({
    id,
    owner: body.owner,
    name: body.name,
    interval_minutes: interval,
    enabled: true,
    next_run_at: nextRun,
    created_at: timestamp,
    updated_at: timestamp,
  });

  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, id));

  return c.json(repo, 201);
});

function latestRunByRepo(
  runs: {
    repo_id: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    error: string | null;
  }[]
): Map<
  string,
  {
    status: string;
    started_at: string;
    finished_at: string | null;
    error: string | null;
  }
> {
  const latest = new Map<
    string,
    {
      status: string;
      started_at: string;
      finished_at: string | null;
      error: string | null;
    }
  >();

  for (const run of runs) {
    const current = latest.get(run.repo_id);
    if (!current || run.started_at > current.started_at) {
      latest.set(run.repo_id, {
        status: run.status,
        started_at: run.started_at,
        finished_at: run.finished_at,
        error: run.error,
      });
    }
  }

  return latest;
}

// GET /repos - List all repos
app.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const enabledFilter = c.req.query("enabled");

  let query = db.select().from(schema.repos);

  if (enabledFilter === "true") {
    query = query.where(eq(schema.repos.enabled, true)) as typeof query;
  } else if (enabledFilter === "false") {
    query = query.where(eq(schema.repos.enabled, false)) as typeof query;
  }

  const results = await query;

  if (results.length === 0) {
    return c.json([]);
  }

  const repoIds = results.map((repo) => repo.id);
  const runs = await db
    .select({
      repo_id: schema.runs.repo_id,
      status: schema.runs.status,
      started_at: schema.runs.started_at,
      finished_at: schema.runs.finished_at,
      error: schema.runs.error,
    })
    .from(schema.runs)
    .where(inArray(schema.runs.repo_id, repoIds));

  const latestRuns = latestRunByRepo(runs);

  return c.json(
    results.map((repo) => ({
      ...repo,
      last_run: latestRuns.get(repo.id) ?? null,
    }))
  );
});

// PATCH /repos/:id - Update a repo
app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    enabled?: boolean;
    interval_minutes?: number;
    min_full_backup_days?: number;
  }>();

  const db = drizzle(c.env.DB);

  const [existing] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, id));

  if (!existing) {
    return c.json({ error: "Repo not found" }, 404);
  }

  const updates: Record<string, unknown> = { updated_at: now() };

  if (body.interval_minutes !== undefined) {
    if (body.interval_minutes < 5) {
      return c.json({ error: "interval_minutes must be >= 5" }, 400);
    }
    updates.interval_minutes = body.interval_minutes;
  }

  if (body.enabled !== undefined) {
    updates.enabled = body.enabled;
  }

  if (body.min_full_backup_days !== undefined) {
    if (body.min_full_backup_days < 1) {
      return c.json({ error: "min_full_backup_days must be >= 1" }, 400);
    }
    updates.min_full_backup_days = body.min_full_backup_days;
  }

  await db.update(schema.repos).set(updates).where(eq(schema.repos.id, id));

  const [updated] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, id));

  return c.json(updated);
});

// DELETE /repos/:id - Delete a repo and enqueue cleanup
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);

  const [existing] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, id));

  if (!existing) {
    return c.json({ error: "Repo not found" }, 404);
  }

  // Delete related records first (artifacts, runs, jobs), then the repo
  const jobRows = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.repo_id, id));

  const jobIds = jobRows.map((j) => j.id);

  if (jobIds.length > 0) {
    const runRows = await db
      .select({ id: schema.runs.id })
      .from(schema.runs)
      .where(inArray(schema.runs.job_id, jobIds));

    const runIds = runRows.map((r) => r.id);

    if (runIds.length > 0) {
      await db
        .delete(schema.artifacts)
        .where(inArray(schema.artifacts.run_id, runIds));
      await db.delete(schema.runs).where(inArray(schema.runs.id, runIds));
    }

    await db.delete(schema.jobs).where(inArray(schema.jobs.id, jobIds));
  }

  await db.delete(schema.repos).where(eq(schema.repos.id, id));

  // Async R2 cleanup: list and delete all objects under this repo's prefix
  const prefix = `repos/${existing.owner}/${existing.name}/`;
  let cursor: string | undefined;
  do {
    const listed = await c.env.BUCKET.list({ prefix, cursor });
    if (listed.objects.length > 0) {
      await Promise.all(
        listed.objects.map((obj) => c.env.BUCKET.delete(obj.key))
      );
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return c.json({ deleted: true });
});

// POST /repos/:id/trigger - Manual trigger
app.post("/:id/trigger", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);

  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, id));

  if (!repo) {
    return c.json({ error: "Repo not found" }, 404);
  }

  // Check for queued or running jobs
  const [activeJob] = await db
    .select()
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.repo_id, id),
        or(eq(schema.jobs.status, "queued"), eq(schema.jobs.status, "running"))
      )
    );

  if (activeJob) {
    return c.json({ error: "A job is already queued or running" }, 409);
  }

  // Check 5-minute cooldown
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const recentRuns = await db
    .select()
    .from(schema.runs)
    .where(
      and(eq(schema.runs.repo_id, id), eq(schema.runs.status, "completed"))
    );

  const hasRecentSuccess = recentRuns.some(
    (r) => r.finished_at && r.finished_at > fiveMinAgo
  );

  if (hasRecentSuccess) {
    return c.json(
      { error: "Cooldown: a backup completed within the last 5 minutes" },
      429
    );
  }

  // Create job and route it through the queue so retries behave like scheduled work.
  const jobId = generateId();
  const timestamp = now();
  const idempotencyKey = `manual_${id}_${Date.now()}`;

  await db.insert(schema.jobs).values({
    id: jobId,
    repo_id: id,
    trigger_source: "manual",
    idempotency_key: idempotencyKey,
    status: "queued",
    attempt: 1,
    deadline_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: timestamp,
    updated_at: timestamp,
  });

  await c.env.JOB_QUEUE.send({
    job_id: jobId,
    repo_id: id,
    idempotency_key: idempotencyKey,
    attempt: 1,
    trigger_source: "manual",
  });

  console.log("[trigger] enqueued manual job", {
    job_id: jobId,
    repo: `${repo.owner}/${repo.name}`,
  });

  return c.json({ job_id: jobId, status: "queued" }, 202);
});

// GET /repos/:id/runs - List runs for a repo
app.get("/:id/runs", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);

  const [repo] = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.id, id));

  if (!repo) {
    return c.json({ error: "Repo not found" }, 404);
  }

  const results = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.repo_id, id));

  return c.json(results);
});

export default app;
