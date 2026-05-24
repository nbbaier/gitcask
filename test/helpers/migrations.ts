export async function applyMigrations(db: D1Database): Promise<void> {
  const migration = `
    CREATE TABLE IF NOT EXISTS repos (
      id text PRIMARY KEY NOT NULL,
      owner text NOT NULL,
      name text NOT NULL,
      interval_minutes integer DEFAULT 60 NOT NULL,
      enabled integer DEFAULT 1 NOT NULL,
      last_pushed_at text,
      last_backup_at text,
      min_full_backup_days integer DEFAULT 7 NOT NULL,
      next_run_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id text PRIMARY KEY NOT NULL,
      repo_id text NOT NULL,
      trigger_source text NOT NULL,
      idempotency_key text NOT NULL,
      status text NOT NULL,
      stage text,
      stage_updated_at text,
      attempt integer DEFAULT 1 NOT NULL,
      deadline_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    );
    CREATE TABLE IF NOT EXISTS runs (
      id text PRIMARY KEY NOT NULL,
      repo_id text NOT NULL,
      job_id text NOT NULL,
      status text NOT NULL,
      started_at text NOT NULL,
      finished_at text,
      error text,
      created_at text NOT NULL,
      FOREIGN KEY (repo_id) REFERENCES repos(id),
      FOREIGN KEY (job_id) REFERENCES jobs(id)
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      repo_id text NOT NULL,
      object_key text NOT NULL,
      sha256 text NOT NULL,
      size_bytes integer NOT NULL,
      created_at text NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (repo_id) REFERENCES repos(id)
    );
  `;

  for (const stmt of migration.split(";").filter((s) => s.trim())) {
    await db.prepare(stmt).run();
  }
}
