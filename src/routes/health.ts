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

// Debug: test container's outbound connectivity to the worker
app.post("/debug/connectivity", async (c) => {
  const { job_id } = await c.req.json<{ job_id?: string }>();
  const testJobId = job_id ?? "test-connectivity";
  const targetUrl = `${c.env.WORKER_URL}/internal/jobs/${testJobId}/progress`;

  try {
    const id = c.env.CONTAINER.idFromName("backup");
    const stub = c.env.CONTAINER.get(id);
    const res = await stub.fetch("http://container/debug/connectivity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_url: targetUrl,
        token: c.env.ADMIN_TOKEN,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const result = await res.json();
    return c.json({ target_url: targetUrl, container_result: result });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : String(err) },
      500
    );
  }
});

export default app;
