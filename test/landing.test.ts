import {
  createExecutionContext,
  env,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

// Claims the product does not actually back. The landing copy must never
// reintroduce these — see issue #14 (R3, honest-copy pass).
const FORBIDDEN_CLAIMS = [
  "restore",
  "encryption",
  "encrypted",
  "filesystem",
  "queryable",
  "install.gitcask.dev",
];

async function fetchLanding(): Promise<{ status: number; body: string }> {
  const req = new Request("http://localhost/");
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return { status: res.status, body: await res.text() };
}

describe("GET / landing page", () => {
  it("returns 200 with no forbidden overclaims (R3)", async () => {
    const { status, body } = await fetchLanding();
    expect(status).toBe(200);
    const lower = body.toLowerCase();
    for (const claim of FORBIDDEN_CLAIMS) {
      expect(lower).not.toContain(claim);
    }
  });

  it("frames gitcask as a GitHub mirror you control", async () => {
    const { body } = await fetchLanding();
    expect(body).toContain("Mirror your GitHub repos");
  });

  it("resolves every in-page anchor to a real element id", async () => {
    const { body } = await fetchLanding();
    const anchors = [...body.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
    expect(anchors).toContain("install");
    for (const id of anchors) {
      expect(body).toContain(`id="${id}"`);
    }
  });
});
