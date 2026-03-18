import type { Context, Next } from "hono";
import type { Env } from "../types.ts";

export async function adminAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | undefined> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const token = authHeader.slice(7);
  if (token !== c.env.ADMIN_TOKEN) {
    return c.json({ error: "Invalid token" }, 401);
  }
  await next();
}
