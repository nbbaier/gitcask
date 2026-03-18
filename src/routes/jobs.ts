import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import { generateId, now } from "../lib/id.ts";
import type { Env } from "../types.ts";

const app = new Hono<{ Bindings: Env }>();

// GET /jobs - List active jobs (queued or running), optionally filtered by repo
app.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const repoId = c.req.query("repo_id");

  const activeFilter = or(
    eq(schema.jobs.status, "queued"),
    eq(schema.jobs.status, "running")
  );

  const conditions = repoId
    ? and(activeFilter, eq(schema.jobs.repo_id, repoId))
    : activeFilter;

  const results = await db
    .select({
      id: schema.jobs.id,
      repo_id: schema.jobs.repo_id,
      trigger_source: schema.jobs.trigger_source,
      status: schema.jobs.status,
      stage: schema.jobs.stage,
      stage_updated_at: schema.jobs.stage_updated_at,
      attempt: schema.jobs.attempt,
      deadline_at: schema.jobs.deadline_at,
      created_at: schema.jobs.created_at,
      updated_at: schema.jobs.updated_at,
    })
    .from(schema.jobs)
    .where(conditions);

  return c.json(results);
});

// GET /jobs/:id - Get a single job
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);

  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, id));

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  return c.json(job);
});

// POST /jobs/:id/cancel - Cancel a queued or running job
app.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);

  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, id));

  if (!job) {
    return c.json({ error: "Job not found" }, 404);
  }

  if (job.status !== "queued" && job.status !== "running") {
    return c.json({ error: `Job is already ${job.status}` }, 409);
  }

  const timestamp = now();

  await db
    .update(schema.jobs)
    .set({
      status: "failed",
      stage: null,
      stage_updated_at: null,
      updated_at: timestamp,
    })
    .where(eq(schema.jobs.id, id));

  await db.insert(schema.runs).values({
    id: generateId(),
    repo_id: job.repo_id,
    job_id: id,
    status: "failed",
    started_at: job.created_at,
    finished_at: timestamp,
    error: "Manually cancelled",
    created_at: timestamp,
  });

  console.log("[jobs] manually cancelled", { job_id: id });
  return c.json({ status: "cancelled", job_id: id });
});

export default app;
