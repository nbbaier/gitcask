import { Hono } from "hono";
import { adminAuth } from "./lib/auth.ts";
import { handleQueueMessage } from "./queue/consumer.ts";
import callbackRoutes from "./routes/callback.ts";
import healthRoutes from "./routes/health.ts";
import jobsRoutes from "./routes/jobs.ts";
import reposRoutes from "./routes/repos.ts";
import runsRoutes from "./routes/runs.ts";
import { runRetentionCleanup } from "./services/retention.ts";
import { handleScheduledEvent } from "./services/scheduler.ts";
import type { Env, QueueMessage } from "./types.ts";

const app = new Hono<{ Bindings: Env }>();

// Public endpoint
app.route("/health", healthRoutes);

// Internal callback endpoint (authenticated)
const internal = new Hono<{ Bindings: Env }>();
internal.use("*", adminAuth);
internal.route("/jobs", callbackRoutes);
app.route("/internal", internal);

// Admin API (authenticated)
const api = new Hono<{ Bindings: Env }>();
api.use("*", adminAuth);
api.route("/repos", reposRoutes);
api.route("/runs", runsRoutes);
api.route("/jobs", jobsRoutes);
app.route("/", api);

export { BackupContainer } from "./container.ts";

export default {
  fetch: app.fetch,

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      await handleQueueMessage(message, env);
    }
  },

  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await handleScheduledEvent(env);
    // Run retention cleanup on every cron tick (lightweight if nothing to do)
    await runRetentionCleanup(env);
  },
};
