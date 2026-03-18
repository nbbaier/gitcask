import { Hono } from "hono";
import type { Env } from "../types.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const checks: Record<string, string> = {};

  // Check D1
  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.d1 = "ok";
  } catch {
    checks.d1 = "unreachable";
  }

  // Check container
  try {
    const res = await fetch(`${c.env.CONTAINER_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    checks.container = res.ok ? "ok" : `error: ${res.status}`;
  } catch {
    checks.container = "unreachable";
  }

  const healthy = checks.d1 === "ok";
  return c.json(
    { status: healthy ? "ok" : "degraded", checks },
    healthy ? 200 : 503
  );
});

export default app;
