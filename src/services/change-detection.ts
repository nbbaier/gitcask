import { fetchGitHubRepoState } from "../lib/github.ts";

export type BackupDecision =
  | {
      action: "run";
      reason:
        | "first_backup"
        | "changes_detected"
        | "periodic_full_backup"
        | "github_unreachable";
    }
  | { action: "skip"; reason: "unchanged"; pushed_at: string };

export interface RepoBackupState {
  last_backup_at: string | null;
  last_pushed_at: string | null;
  min_full_backup_days: number;
}

export function evaluateBackupNeed(
  repo: RepoBackupState,
  currentPushedAt: string | null,
  nowMs = Date.now()
): BackupDecision {
  if (!repo.last_backup_at) {
    return { action: "run", reason: "first_backup" };
  }

  const fullBackupDueMs = repo.min_full_backup_days * 24 * 60 * 60 * 1000;
  const lastBackupMs = new Date(repo.last_backup_at).getTime();
  if (nowMs - lastBackupMs >= fullBackupDueMs) {
    return { action: "run", reason: "periodic_full_backup" };
  }

  if (!currentPushedAt) {
    return { action: "run", reason: "github_unreachable" };
  }

  if (repo.last_pushed_at === currentPushedAt) {
    return { action: "skip", reason: "unchanged", pushed_at: currentPushedAt };
  }

  return { action: "run", reason: "changes_detected" };
}

export async function checkScheduledBackup(
  repo: { name: string; owner: string } & RepoBackupState,
  pat: string,
  nowMs?: number
): Promise<BackupDecision> {
  const state = await fetchGitHubRepoState(repo.owner, repo.name, pat);
  return evaluateBackupNeed(repo, state?.pushed_at ?? null, nowMs);
}
