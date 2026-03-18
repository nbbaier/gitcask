import { Hono } from "hono";
import type { Env } from "../types.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const checks: Record<string, string> = {};

  try {
    await c.env.DB.prepare("SELECT 1").first();
    checks.d1 = "ok";
  } catch {
    checks.d1 = "unreachable";
  }

  try {
    const id = c.env.CONTAINER.idFromName("backup");
    const stub = c.env.CONTAINER.get(id);
    const res = await stub.fetch("http://container/health", {
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
