import type * as schema from "../db/schema.ts";
import type { ContainerRequest, Env } from "../types.ts";

type Repo = typeof schema.repos.$inferSelect;

export type DispatchResult =
  | { accepted: true }
  | { accepted: false; error: string };

function buildContainerRequest(
  jobId: string,
  repo: Repo,
  env: Env
): ContainerRequest {
  return {
    job_id: jobId,
    owner: repo.owner,
    repo: repo.name,
    pat: env.GITHUB_PAT,
    r2_credentials: {
      access_key_id: env.R2_ACCESS_KEY_ID?.trim() ?? "",
      secret_access_key: env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
      endpoint: env.R2_ENDPOINT?.trim() ?? "",
      bucket: "gitcask-backups",
    },
    object_key_prefix: `repos/${repo.owner}/${repo.name}/snapshots/`,
    callback_url: `${env.WORKER_URL}/internal/jobs/${jobId}/complete`,
    progress_url: `${env.WORKER_URL}/internal/jobs/${jobId}/progress`,
    callback_token: env.ADMIN_TOKEN,
  };
}

export async function dispatch(
  jobId: string,
  repo: Repo,
  env: Env
): Promise<DispatchResult> {
  const payload = buildContainerRequest(jobId, repo, env);

  try {
    const id = env.CONTAINER.idFromName("backup");
    const stub = env.CONTAINER.get(id);
    const res = await stub.fetch("http://container/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      return {
        accepted: false,
        error: `Container returned ${res.status}`,
      };
    }

    return { accepted: true };
  } catch (err) {
    return {
      accepted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
