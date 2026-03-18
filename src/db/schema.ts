import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const repos = sqliteTable(
  "repos",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    interval_minutes: integer("interval_minutes").notNull().default(60),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    next_run_at: text("next_run_at"),
    created_at: text("created_at").notNull(),
    updated_at: text("updated_at").notNull(),
  },
  (t) => ({ uniqOwnerName: unique().on(t.owner, t.name) })
);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  repo_id: text("repo_id")
    .notNull()
    .references(() => repos.id),
  trigger_source: text("trigger_source", {
    enum: ["schedule", "manual"],
  }).notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  status: text("status", {
    enum: ["queued", "running", "completed", "failed"],
  }).notNull(),
  stage: text("stage", {
    enum: [
      "cloning",
      "archiving",
      "hashing",
      "uploading",
      "fetching_metadata",
      "uploading_metadata",
    ],
  }),
  stage_updated_at: text("stage_updated_at"),
  attempt: integer("attempt").notNull().default(1),
  deadline_at: text("deadline_at"),
  created_at: text("created_at").notNull(),
  updated_at: text("updated_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  repo_id: text("repo_id")
    .notNull()
    .references(() => repos.id),
  job_id: text("job_id")
    .notNull()
    .references(() => jobs.id),
  status: text("status", {
    enum: ["running", "completed", "failed"],
  }).notNull(),
  started_at: text("started_at").notNull(),
  finished_at: text("finished_at"),
  error: text("error"),
  created_at: text("created_at").notNull(),
});

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  run_id: text("run_id")
    .notNull()
    .references(() => runs.id),
  repo_id: text("repo_id")
    .notNull()
    .references(() => repos.id),
  object_key: text("object_key").notNull(),
  sha256: text("sha256").notNull(),
  size_bytes: integer("size_bytes").notNull(),
  created_at: text("created_at").notNull(),
});
