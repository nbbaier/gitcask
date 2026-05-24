import { describe, expect, it } from "vitest";
import { evaluateBackupNeed } from "../src/services/change-detection.ts";

const baseRepo = {
  last_pushed_at: "2026-03-01T12:00:00.000Z",
  last_backup_at: "2026-03-01T12:05:00.000Z",
  min_full_backup_days: 7,
};

describe("evaluateBackupNeed", () => {
  it("runs the first backup when no prior backup exists", () => {
    const decision = evaluateBackupNeed(
      {
        ...baseRepo,
        last_backup_at: null,
        last_pushed_at: null,
      },
      "2026-03-01T12:00:00.000Z"
    );

    expect(decision).toEqual({ action: "run", reason: "first_backup" });
  });

  it("skips when pushed_at is unchanged", () => {
    const decision = evaluateBackupNeed(
      baseRepo,
      "2026-03-01T12:00:00.000Z",
      new Date("2026-03-02T12:00:00.000Z").getTime()
    );

    expect(decision).toEqual({
      action: "skip",
      reason: "unchanged",
      pushed_at: "2026-03-01T12:00:00.000Z",
    });
  });

  it("runs when pushed_at changed", () => {
    const decision = evaluateBackupNeed(
      baseRepo,
      "2026-03-02T08:00:00.000Z",
      new Date("2026-03-02T12:00:00.000Z").getTime()
    );

    expect(decision).toEqual({ action: "run", reason: "changes_detected" });
  });

  it("runs a periodic full backup after min_full_backup_days", () => {
    const decision = evaluateBackupNeed(
      baseRepo,
      "2026-03-01T12:00:00.000Z",
      new Date("2026-03-10T12:00:00.000Z").getTime()
    );

    expect(decision).toEqual({ action: "run", reason: "periodic_full_backup" });
  });

  it("runs when GitHub state is unavailable", () => {
    const decision = evaluateBackupNeed(
      baseRepo,
      null,
      new Date("2026-03-02T12:00:00.000Z").getTime()
    );

    expect(decision).toEqual({ action: "run", reason: "github_unreachable" });
  });
});
