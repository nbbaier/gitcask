export interface GitHubRepoState {
  pushed_at: string;
}

type GitHubRepoResponse =
  | { ok: true; pushed_at: string | null }
  | { ok: false; status: number; statusText: string };

async function fetchGitHubRepo(
  owner: string,
  name: string,
  pat: string
): Promise<GitHubRepoResponse> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${name}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      "User-Agent": "gitcask/1.0",
      Accept: "application/vnd.github+json",
    },
  });

  if (!res.ok) {
    return { ok: false, status: res.status, statusText: res.statusText };
  }

  const data = (await res.json()) as { pushed_at?: string };
  return { ok: true, pushed_at: data.pushed_at ?? null };
}

export async function fetchGitHubRepoState(
  owner: string,
  name: string,
  pat: string
): Promise<GitHubRepoState | null> {
  const result = await fetchGitHubRepo(owner, name, pat);
  if (!(result.ok && result.pushed_at)) {
    return null;
  }

  return { pushed_at: result.pushed_at };
}

export type GitHubRepoAccessResult =
  | { ok: true }
  | { ok: false; status: number; statusText: string };

export async function validateGitHubRepoAccess(
  owner: string,
  name: string,
  pat: string
): Promise<GitHubRepoAccessResult> {
  const result = await fetchGitHubRepo(owner, name, pat);
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      statusText: result.statusText,
    };
  }

  return { ok: true };
}
