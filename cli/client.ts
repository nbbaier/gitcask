interface ClientOptions {
  token: string;
  url: string;
}

interface Repo {
  created_at: string;
  enabled: boolean;
  id: string;
  interval_minutes: number;
  name: string;
  next_run_at: string | null;
  owner: string;
  updated_at: string;
}

interface Job {
  attempt: number;
  created_at: string;
  deadline_at: string | null;
  id: string;
  repo_id: string;
  stage: string | null;
  stage_updated_at: string | null;
  status: string;
  trigger_source: string;
  updated_at: string;
}

interface Run {
  created_at: string;
  error: string | null;
  finished_at: string | null;
  id: string;
  job_id: string;
  repo_id: string;
  started_at: string;
  status: string;
}

interface Artifact {
  created_at: string;
  id: string;
  object_key: string;
  repo_id: string;
  run_id: string;
  sha256: string;
  size_bytes: number;
}

interface RunDetail extends Run {
  artifacts: Artifact[];
}

interface HealthResponse {
  checks: Record<string, string>;
  status: string;
}

const TRAILING_SLASH = /\/$/;

async function request<T>(
  base: string,
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${base.replace(TRAILING_SLASH, "")}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      (body as Record<string, string>).error ??
      `${res.status} ${res.statusText}`;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export function createClient({ url, token }: ClientOptions) {
  return {
    health: () => request<HealthResponse>(url, token, "/health"),

    listRepos: (enabled?: boolean) => {
      const params = enabled === undefined ? "" : `?enabled=${enabled}`;
      return request<Repo[]>(url, token, `/repos${params}`);
    },

    addRepo: (owner: string, name: string, intervalMinutes?: number) =>
      request<Repo>(url, token, "/repos", {
        method: "POST",
        body: JSON.stringify({
          owner,
          name,
          ...(intervalMinutes !== undefined && {
            interval_minutes: intervalMinutes,
          }),
        }),
      }),

    updateRepo: (
      id: string,
      updates: { interval_minutes?: number; enabled?: boolean }
    ) =>
      request<Repo>(url, token, `/repos/${id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      }),

    deleteRepo: (id: string) =>
      request<{ deleted: boolean }>(url, token, `/repos/${id}`, {
        method: "DELETE",
      }),

    triggerBackup: (id: string) =>
      request<{ job_id: string; status: string }>(
        url,
        token,
        `/repos/${id}/trigger`,
        { method: "POST" }
      ),

    listJobs: (repoId?: string) => {
      const params = repoId ? `?repo_id=${repoId}` : "";
      return request<Job[]>(url, token, `/jobs${params}`);
    },

    getJob: (jobId: string) => request<Job>(url, token, `/jobs/${jobId}`),

    listRuns: (repoId: string) =>
      request<Run[]>(url, token, `/repos/${repoId}/runs`),

    getRun: (runId: string) => request<RunDetail>(url, token, `/runs/${runId}`),
  };
}

export type Client = ReturnType<typeof createClient>;
