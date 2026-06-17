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

app.get("/", (c) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>gitcask - GitHub backups with a filesystem interface</title>
    <meta
      name="description"
      content="Automated GitHub repository backups powered by Cloudflare Workers, D1, R2, and Queues."
    />
    <style>
      :root {
        color-scheme: light;
        --bg: #f3ecdf;
        --bg-elevated: #f8f2e6;
        --ink: #171410;
        --muted: #5f584d;
        --line: rgba(23, 20, 16, 0.18);
        --accent: #171410;
        --accent-soft: rgba(23, 20, 16, 0.08);
        --shadow: 0 18px 60px rgba(23, 20, 16, 0.08);
      }

      * {
        box-sizing: border-box;
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(255, 255, 255, 0.4), transparent 40%),
          linear-gradient(180deg, #f7f1e6 0%, var(--bg) 100%);
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        max-width: 1240px;
        margin: 0 auto;
        padding: 24px;
      }

      .topbar,
      .section,
      .footer {
        border: 1px solid var(--line);
        background: rgba(248, 242, 230, 0.7);
        backdrop-filter: blur(10px);
      }

      .topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 18px 22px;
      }

      .brand,
      .nav,
      .meta,
      .eyebrow,
      .kicker,
      .stat-label {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        font-size: 11px;
      }

      .brand {
        font-weight: 700;
      }

      .nav {
        display: flex;
        gap: 18px;
        color: var(--muted);
      }

      .hero {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 0;
        min-height: 72vh;
      }

      .hero-copy {
        padding: clamp(28px, 4vw, 56px);
        border-right: 1px solid var(--line);
      }

      .eyebrow {
        color: var(--muted);
        margin-bottom: 28px;
      }

      h1,
      h2,
      h3 {
        margin: 0;
        line-height: 0.95;
        letter-spacing: -0.05em;
      }

      h1 {
        font-size: clamp(4.4rem, 11vw, 8.6rem);
        max-width: 9ch;
      }

      .headline-mark {
        display: inline-block;
        padding: 0.05em 0.18em 0.14em;
        background: var(--accent);
        color: #f6efe3;
        box-shadow: var(--shadow);
      }

      .lede {
        margin-top: 28px;
        max-width: 46ch;
        font-size: 1.08rem;
        line-height: 1.65;
        color: var(--muted);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 28px;
      }

      .button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 48px;
        padding: 0 18px;
        border: 1px solid var(--accent);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        transition:
          transform 180ms ease,
          background-color 180ms ease,
          color 180ms ease;
      }

      .button:hover {
        transform: translateY(-1px);
      }

      .button.primary {
        background: var(--accent);
        color: #f7f0e4;
      }

      .button.secondary {
        background: transparent;
      }

      .hero-panel {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: 24px;
        padding: clamp(28px, 4vw, 56px);
      }

      .card {
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.28);
        padding: 18px;
      }

      .code {
        margin: 0;
        overflow-x: auto;
        padding: 18px;
        border: 1px solid var(--line);
        background: rgba(23, 20, 16, 0.04);
        font-family: "SFMono-Regular", ui-monospace, "Cascadia Code", monospace;
        font-size: 0.86rem;
        line-height: 1.7;
        white-space: pre-wrap;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        padding-top: 24px;
      }

      .stat {
        border-top: 1px solid var(--line);
        padding-top: 16px;
      }

      .stat-value {
        font-size: clamp(1.6rem, 3vw, 2.4rem);
        font-weight: 700;
        letter-spacing: -0.05em;
      }

      .section {
        border-top: none;
        padding: 0;
      }

      .section-grid {
        display: grid;
        grid-template-columns: 0.8fr 1.2fr;
      }

      .section-heading {
        padding: 28px;
        border-right: 1px solid var(--line);
      }

      .section-body {
        padding: 28px;
      }

      .section-title {
        font-size: clamp(2.2rem, 4vw, 4rem);
        max-width: 10ch;
      }

      .feature-list {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }

      .feature {
        padding: 20px;
        border: 1px solid var(--line);
        min-height: 160px;
        background: rgba(255, 255, 255, 0.18);
      }

      .feature h3 {
        font-size: 1.3rem;
        margin-bottom: 12px;
      }

      .feature p {
        margin: 0;
        color: var(--muted);
        line-height: 1.6;
      }

      .footer {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        padding: 22px;
      }

      .footer a {
        color: var(--muted);
      }

      @media (max-width: 960px) {
        .hero,
        .section-grid,
        .feature-list,
        .stats {
          grid-template-columns: 1fr;
        }

        .hero-copy {
          border-right: none;
          border-bottom: 1px solid var(--line);
        }

        .section-heading {
          border-right: none;
          border-bottom: 1px solid var(--line);
        }
      }

      @media (max-width: 640px) {
        .shell {
          padding: 12px;
        }

        .topbar,
        .hero-copy,
        .hero-panel,
        .section-heading,
        .section-body,
        .footer {
          padding: 18px;
        }

        h1 {
          font-size: clamp(3.4rem, 18vw, 5.2rem);
        }

        .nav {
          gap: 10px;
        }

        .footer {
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div class="brand">gitcask</div>
        <nav class="nav" aria-label="Primary">
          <a href="#how-it-works">How it works</a>
          <a href="#use-cases">Use cases</a>
          <a href="/health">Health</a>
        </nav>
        <a class="button secondary" href="#install">Install</a>
      </header>

      <section class="hero section">
        <div class="hero-copy">
          <div class="eyebrow">Back up GitHub like a filesystem</div>
          <h1>
            <span class="headline-mark">the repo</span><br />
            <span class="headline-mark">is the API.</span>
          </h1>
          <p class="lede">
            gitcask turns GitHub repositories into durable, queryable backup
            targets. Cloudflare Workers handles orchestration, D1 stores state,
            R2 keeps the payloads, and queues move work without the usual backup
            glue.
          </p>
          <div class="actions">
            <a class="button primary" href="#install">Get started</a>
            <a class="button secondary" href="#use-cases">View use cases</a>
          </div>
          <div class="stats" aria-label="Highlights">
            <div class="stat">
              <div class="stat-label">Storage</div>
              <div class="stat-value">R2</div>
            </div>
            <div class="stat">
              <div class="stat-label">State</div>
              <div class="stat-value">D1</div>
            </div>
            <div class="stat">
              <div class="stat-label">Jobs</div>
              <div class="stat-value">Queues</div>
            </div>
          </div>
        </div>
        <div class="hero-panel">
          <div class="card">
            <div class="kicker">Install</div>
            <pre class="code">curl -fsSL https://install.gitcask.dev | sh</pre>
          </div>
          <div class="card">
            <div class="kicker">What it buys you</div>
            <p class="lede" style="margin: 12px 0 0;">
              Every repo backup is tracked as a job, every run has history, and
              restores can be reasoned about with the same primitives your
              agents already use: files, paths, and diffs.
            </p>
          </div>
        </div>
      </section>

      <section id="how-it-works" class="section">
        <div class="section-grid">
          <div class="section-heading">
            <div class="eyebrow">How it works</div>
            <h2 class="section-title">Treat backups like a filesystem, not a dashboard.</h2>
          </div>
          <div class="section-body">
            <div class="feature-list">
              <article class="feature">
                <h3>Atomic job flow</h3>
                <p>
                  Schedule, dispatch, and complete backup jobs with explicit
                  state transitions. Nothing relies on best effort polling.
                </p>
              </article>
              <article class="feature">
                <h3>Versioned runs</h3>
                <p>
                  Every backup run is preserved with timestamps, status, and
                  error context for postmortems or replays.
                </p>
              </article>
              <article class="feature">
                <h3>Queue-backed execution</h3>
                <p>
                  The worker orchestrates work, while the container handles
                  cloning and upload work with the right isolation boundary.
                </p>
              </article>
              <article class="feature">
                <h3>Filesystem mental model</h3>
                <p>
                  Paths, files, and repositories are first-class. That keeps the
                  interface understandable for humans and automation alike.
                </p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section id="use-cases" class="section">
        <div class="section-grid">
          <div class="section-heading">
            <div class="eyebrow">Use cases</div>
            <h2 class="section-title">Built for people who think in trees, not tickets.</h2>
          </div>
          <div class="section-body">
            <div class="feature-list">
              <article class="feature">
                <h3>Shared agent state</h3>
                <p>
                  Let multiple agents work against the same repository snapshot
                  without stepping on each other.
                </p>
              </article>
              <article class="feature">
                <h3>Local-first mirrors</h3>
                <p>
                  Mirror repos into a stable filesystem surface for inspection,
                  scripting, or offline work.
                </p>
              </article>
              <article class="feature">
                <h3>Recovery workflows</h3>
                <p>
                  Keep clean run history and stored artifacts so rollback and
                  recovery are operationally boring.
                </p>
              </article>
              <article class="feature" id="install">
                <h3>Quick setup</h3>
                <p>
                  Cloudflare Workers, D1, R2, and Queues are the only moving
                  parts. The rest is a straightforward admin API.
                </p>
              </article>
            </div>
          </div>
        </div>
      </section>

      <footer class="footer">
        <div class="meta">gitcask</div>
        <div class="nav">
          <a href="/health">Health</a>
          <a href="/repos">API</a>
        </div>
      </footer>
    </main>
  </body>
</html>`;

  return c.html(html);
});

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

// biome-ignore lint/performance/noBarrelFile: We need to export the container for the container to be used
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
