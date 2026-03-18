import { and, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { generateId, now } from "../lib/id.ts";
import type { ContainerRequest, Env, QueueMessage } from "../types.ts";

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

  // Validate repo exists and PAT has access
  const ghRes = await fetch(
    `https://api.github.com/repos/${body.owner}/${body.name}`,
    {
      headers: {
        Authorization: `Bearer ${c.env.GITHUB_PAT}`,
        "User-Agent": "gitcask/1.0",
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!ghRes.ok) {
    return c.json(
      {
        error: `GitHub repo not accessible: ${ghRes.status} ${ghRes.statusText}`,
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
  return c.json(results);
});

// PATCH /repos/:id - Update a repo
app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{
    interval_minutes?: number;
    enabled?: boolean;
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

  // Create job and dispatch directly to container (bypassing queue)
  const jobId = generateId();
  const timestamp = now();
  const idempotencyKey = `manual_${id}_${Date.now()}`;

  await db.insert(schema.jobs).values({
    id: jobId,
    repo_id: id,
    trigger_source: "manual",
    idempotency_key: idempotencyKey,
    status: "running",
    attempt: 1,
    deadline_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    created_at: timestamp,
    updated_at: timestamp,
  });

  console.log("[trigger] dispatching directly to container", {
    job_id: jobId,
    repo: `${repo.owner}/${repo.name}`,
  });

  const containerPayload: ContainerRequest = {
    job_id: jobId,
    owner: repo.owner,
    repo: repo.name,
    pat: c.env.GITHUB_PAT,
    r2_credentials: {
      access_key_id: c.env.R2_ACCESS_KEY_ID?.trim() ?? "",
      secret_access_key: c.env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
      endpoint: c.env.R2_ENDPOINT?.trim() ?? "",
      bucket: "gitcask-backups",
    },
    object_key_prefix: `repos/${repo.owner}/${repo.name}/snapshots/`,
    callback_url: `${c.env.WORKER_URL}/internal/jobs/${jobId}/complete`,
    progress_url: `${c.env.WORKER_URL}/internal/jobs/${jobId}/progress`,
    callback_token: c.env.ADMIN_TOKEN,
  };

  // Use waitUntil to dispatch in the background so the HTTP response doesn't cancel it
  const env = c.env;
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const doId = env.CONTAINER.idFromName("backup");
        const stub = env.CONTAINER.get(doId);
        const res = await stub.fetch("http://container/backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(containerPayload),
        });

        if (!res.ok && res.status !== 202) {
          throw new Error(`Container returned ${res.status}`);
        }

        console.log("[trigger] container accepted job", {
          job_id: jobId,
          status: res.status,
        });
      } catch (err) {
        console.error("[trigger] container dispatch failed", {
          job_id: jobId,
          error: err instanceof Error ? err.message : String(err),
        });
        const failDb = drizzle(env.DB);
        await failDb
          .update(schema.jobs)
          .set({ status: "failed", updated_at: now() })
          .where(eq(schema.jobs.id, jobId));
      }
    })()
  );

  return c.json({ job_id: jobId, status: "running" }, 202);
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
