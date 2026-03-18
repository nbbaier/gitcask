import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
// biome-ignore lint/performance/noNamespaceImport: We need to import the schema as a namespace
import * as schema from "../db/schema.ts";
import type { Env } from "../types.ts";

const app = new Hono<{ Bindings: Env }>();

// GET /runs/:id - Get run details
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const db = drizzle(c.env.DB);

  const [run] = await db
    .select()
    .from(schema.runs)
    .where(eq(schema.runs.id, id));

  if (!run) {
    return c.json({ error: "Run not found" }, 404);
  }

  const runArtifacts = await db
    .select()
    .from(schema.artifacts)
    .where(eq(schema.artifacts.run_id, id));

  return c.json({ ...run, artifacts: runArtifacts });
});

export default app;
