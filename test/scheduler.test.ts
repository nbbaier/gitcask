import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleScheduledEvent } from "../src/services/scheduler.ts";
import { applyMigrations } from "./helpers/migrations.ts";

describe("handleScheduledEvent change detection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await applyMigrations(env.DB);
    await env.DB.prepare("DELETE FROM runs").run();
    await env.DB.prepare("DELETE FROM jobs").run();
    await env.DB.prepare("DELETE FROM repos").run();
  });

  it("skips unchanged repos without enqueueing a backup job", async () => {
    const now = new Date("2026-03-02T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const repoId = crypto.randomUUID();
    const ts = "2026-03-01T12:00:00.000Z";

    await env.DB.prepare(
      "INSERT INTO repos (id, owner, name, interval_minutes, enabled, last_pushed_at, last_backup_at, min_full_backup_days, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        repoId,
        "test-owner",
        "test-repo",
        60,
        1,
        "2026-03-01T12:00:00.000Z",
        "2026-03-01T12:05:00.000Z",
        7,
        ts,
        ts,
        ts
      )
      .run();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ pushed_at: "2026-03-01T12:00:00.000Z" }), {
        status: 200,
      })
    );

    const send = vi.fn();
    await handleScheduledEvent({ ...env, JOB_QUEUE: { send } as never });

    expect(send).not.toHaveBeenCalled();

    const jobCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM jobs WHERE repo_id = ?"
    )
      .bind(repoId)
      .first<{ count: number }>();
    expect(jobCount?.count).toBe(0);

    const runCount = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM runs WHERE repo_id = ?"
    )
      .bind(repoId)
      .first<{ count: number }>();
    expect(runCount?.count).toBe(0);

    const repo = await env.DB.prepare(
      "SELECT next_run_at FROM repos WHERE id = ?"
    )
      .bind(repoId)
      .first<{ next_run_at: string }>();
    expect(repo?.next_run_at).toBe("2026-03-02T13:00:00.000Z");
  });

  it("enqueues a backup when pushed_at changed", async () => {
    const now = new Date("2026-03-02T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const repoId = crypto.randomUUID();
    const ts = "2026-03-01T12:00:00.000Z";

    await env.DB.prepare(
      "INSERT INTO repos (id, owner, name, interval_minutes, enabled, last_pushed_at, last_backup_at, min_full_backup_days, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        repoId,
        "test-owner",
        "test-repo",
        60,
        1,
        "2026-03-01T12:00:00.000Z",
        "2026-03-01T12:05:00.000Z",
        7,
        ts,
        ts,
        ts
      )
      .run();

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ pushed_at: "2026-03-02T08:00:00.000Z" }), {
        status: 200,
      })
    );

    const send = vi.fn();
    await handleScheduledEvent({ ...env, JOB_QUEUE: { send } as never });

    expect(send).toHaveBeenCalledTimes(1);

    const run = await env.DB.prepare(
      "SELECT status FROM runs WHERE repo_id = ?"
    )
      .bind(repoId)
      .first<{ status: string }>();
    expect(run).toBeNull();
  });
});
