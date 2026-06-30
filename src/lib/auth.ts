import type { Context, Next } from "hono";
import type { Env } from "../types.ts";

const AUTH_SCHEME = "Bearer ";
const UNAUTHORIZED_RESPONSE = { error: "Unauthorized" } as const;
const textEncoder = new TextEncoder();

function timingSafeEqual(actual: string, expected: string): boolean {
  const actualBytes = textEncoder.encode(actual);
  const expectedBytes = textEncoder.encode(expected);
  let difference = Math.abs(actualBytes.length - expectedBytes.length);

  for (const [index, expectedByte] of expectedBytes.entries()) {
    difference += Math.abs((actualBytes[index] ?? 0) - expectedByte);
  }

  return difference === 0;
}

export async function adminAuth(
  c: Context<{ Bindings: Env }>,
  next: Next
): Promise<Response | undefined> {
  const authHeader = c.req.header("Authorization") ?? "";
  const token = authHeader.startsWith(AUTH_SCHEME)
    ? authHeader.slice(AUTH_SCHEME.length)
    : "";

  if (!timingSafeEqual(token, c.env.ADMIN_TOKEN)) {
    return c.json(UNAUTHORIZED_RESPONSE, 401);
  }

  await next();
}
