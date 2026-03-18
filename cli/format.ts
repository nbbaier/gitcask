type Row = Record<string, unknown>;

interface Column {
  key: string;
  label: string;
  width?: number;
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatTable(rows: Row[], columns: Column[]): string {
  if (rows.length === 0) {
    return "No results.";
  }

  const widths = columns.map((col) => {
    const values = rows.map((r) => String(r[col.key] ?? "").length);
    return Math.max(col.label.length, ...values);
  });

  const header = columns
    .map((col, i) => col.label.padEnd(widths[i]))
    .join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((row) =>
    columns
      .map((col, i) => String(row[col.key] ?? "").padEnd(widths[i]))
      .join("  ")
  );

  return [header, separator, ...body].join("\n");
}

const repoColumns: Column[] = [
  { key: "id", label: "ID" },
  { key: "repo", label: "REPO" },
  { key: "interval_minutes", label: "INTERVAL" },
  { key: "enabled", label: "ENABLED" },
  { key: "next_run_at", label: "NEXT RUN" },
];

export function formatRepos(repos: Row[]): string {
  const rows = repos.map((r) => ({
    ...r,
    repo: `${r.owner}/${r.name}`,
    enabled: r.enabled ? "yes" : "no",
    next_run_at: r.next_run_at ?? "-",
  }));
  return formatTable(rows, repoColumns);
}

const jobColumns: Column[] = [
  { key: "id", label: "ID" },
  { key: "repo_id", label: "REPO ID" },
  { key: "status", label: "STATUS" },
  { key: "stage", label: "STAGE" },
  { key: "attempt", label: "ATTEMPT" },
  { key: "elapsed", label: "ELAPSED" },
  { key: "trigger_source", label: "TRIGGER" },
];

function formatElapsed(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m${remainingSeconds}s`;
}

export function formatJobs(jobs: Row[]): string {
  const rows = jobs.map((j) => ({
    ...j,
    stage: j.stage ?? "-",
    elapsed: formatElapsed(j.created_at as string),
  }));
  return formatTable(rows, jobColumns);
}

export function formatJobDetail(job: Row): string {
  const elapsed = formatElapsed(job.created_at as string);
  const lines = [
    `Job:      ${job.id}`,
    `Repo:     ${job.repo_id}`,
    `Status:   ${job.status}`,
    `Stage:    ${job.stage ?? "-"}`,
    `Attempt:  ${job.attempt}`,
    `Trigger:  ${job.trigger_source}`,
    `Elapsed:  ${elapsed}`,
    `Deadline: ${job.deadline_at ?? "-"}`,
    `Created:  ${job.created_at}`,
  ];
  if (job.stage_updated_at) {
    lines.push(`Stage at: ${job.stage_updated_at}`);
  }
  return lines.join("\n");
}

const runColumns: Column[] = [
  { key: "id", label: "ID" },
  { key: "status", label: "STATUS" },
  { key: "started_at", label: "STARTED" },
  { key: "finished_at", label: "FINISHED" },
  { key: "error", label: "ERROR" },
];

export function formatRuns(runs: Row[]): string {
  const rows = runs.map((r) => ({
    ...r,
    finished_at: r.finished_at ?? "-",
    error: r.error ?? "-",
  }));
  return formatTable(rows, runColumns);
}

const artifactColumns: Column[] = [
  { key: "id", label: "ID" },
  { key: "object_key", label: "KEY" },
  { key: "size_bytes", label: "SIZE" },
  { key: "sha256", label: "SHA256" },
];

export function formatRunDetail(run: Row & { artifacts?: Row[] }): string {
  const lines = [
    `Run:      ${run.id}`,
    `Status:   ${run.status}`,
    `Started:  ${run.started_at}`,
    `Finished: ${run.finished_at ?? "-"}`,
    `Error:    ${run.error ?? "-"}`,
  ];

  const artifacts = run.artifacts;
  if (artifacts && artifacts.length > 0) {
    lines.push("", "Artifacts:", formatTable(artifacts, artifactColumns));
  } else {
    lines.push("", "No artifacts.");
  }

  return lines.join("\n");
}
