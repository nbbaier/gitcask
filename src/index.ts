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
    <title>gitcask - automated GitHub repository mirroring on Cloudflare</title>
    <meta
      name="description"
      content="Automated GitHub repository backups powered by Cloudflare Workers, D1, R2, and Queues."
    />
    <style>
      :root {
        color-scheme: light;
        --bg: #ffffff;
        --bg-soft: #f7f7f8;
        --bg-panel: #ffffff;
        --ink: #11150f;
        --ink-2: #2b2f2a;
        --muted: #6a6f76;
        --line: #e6e7ea;
        --line-strong: #d6d8dd;
        --accent: #f6821f;
        --accent-ink: #b75c08;
        --accent-soft: #fff4e8;
        --accent-line: #f7c79a;
        --radius: 14px;
        --radius-lg: 20px;
        --shadow-sm: 0 1px 2px rgba(17, 21, 15, 0.06);
        --shadow: 0 10px 30px rgba(17, 21, 15, 0.06), 0 2px 8px rgba(17, 21, 15, 0.04);
        --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, monospace;
        --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      html {
        scroll-behavior: smooth;
      }

      body {
        margin: 0;
        font-family: var(--sans);
        color: var(--ink);
        background: var(--bg);
        line-height: 1.55;
        -webkit-font-smoothing: antialiased;
      }

      a {
        color: inherit;
        text-decoration: none;
      }

      .shell {
        max-width: 1140px;
        margin: 0 auto;
        padding: 0 24px;
      }

      /* ---------- top bar ---------- */
      .topbar {
        position: sticky;
        top: 0;
        z-index: 20;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 16px 24px;
        max-width: 1140px;
        margin: 0 auto;
        background: rgba(255, 255, 255, 0.82);
        backdrop-filter: saturate(180%) blur(12px);
        border-bottom: 1px solid transparent;
      }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 9px;
        font-weight: 650;
        font-size: 17px;
        letter-spacing: -0.01em;
      }

      .brand .dot {
        width: 11px;
        height: 11px;
        border-radius: 3px;
        background: var(--accent);
        box-shadow: 0 0 0 4px var(--accent-soft);
      }

      .nav {
        display: flex;
        align-items: center;
        gap: 26px;
      }

      .nav a {
        font-size: 14.5px;
        color: var(--muted);
        font-weight: 500;
        transition: color 0.15s ease;
      }

      .nav a:hover {
        color: var(--ink);
      }

      .button {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        font-family: inherit;
        font-size: 14.5px;
        font-weight: 600;
        padding: 9px 16px;
        border-radius: 10px;
        border: 1px solid var(--line-strong);
        background: var(--bg);
        color: var(--ink);
        cursor: pointer;
        transition: all 0.15s ease;
        white-space: nowrap;
      }

      .button:hover {
        border-color: #c4c7cd;
        box-shadow: var(--shadow-sm);
      }

      .button.primary {
        background: var(--accent);
        border-color: var(--accent);
        color: #fff;
      }

      .button.primary:hover {
        background: #ea7a17;
        border-color: #ea7a17;
        box-shadow: 0 6px 18px rgba(246, 130, 31, 0.32);
      }

      .nav-cta {
        font-size: 14px;
        padding: 8px 14px;
      }

      /* ---------- hero ---------- */
      .hero {
        display: grid;
        grid-template-columns: 1.05fr 0.95fr;
        gap: 56px;
        align-items: center;
        padding: 76px 0 64px;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: var(--accent-ink);
        background: var(--accent-soft);
        border: 1px solid var(--accent-line);
        padding: 5px 12px;
        border-radius: 999px;
        margin-bottom: 22px;
      }

      h1 {
        font-size: clamp(40px, 6vw, 62px);
        line-height: 1.02;
        letter-spacing: -0.03em;
        margin: 0 0 20px;
        font-weight: 700;
      }

      h1 .grad {
        background: linear-gradient(92deg, var(--accent) 0%, #ff9d3f 100%);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      .lede {
        font-size: 18px;
        color: var(--ink-2);
        max-width: 34ch;
        margin: 0 0 30px;
      }

      .actions {
        display: flex;
        gap: 12px;
        margin-bottom: 36px;
      }

      .actions .button {
        padding: 12px 20px;
        font-size: 15px;
        border-radius: 12px;
      }

      .stats {
        display: flex;
        gap: 30px;
      }

      .stat-label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted);
        font-weight: 600;
        margin-bottom: 2px;
      }

      .stat-value {
        font-size: 20px;
        font-weight: 680;
        letter-spacing: -0.01em;
      }

      /* ---------- hero panel ---------- */
      .hero-panel {
        display: grid;
        gap: 16px;
      }

      .card {
        background: var(--bg-panel);
        border: 1px solid var(--line);
        border-radius: var(--radius-lg);
        padding: 22px;
        box-shadow: var(--shadow);
      }

      .kicker {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12.5px;
        font-weight: 650;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--muted);
        margin-bottom: 14px;
      }

      .kicker::before {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent);
      }

      .terminal {
        font-family: var(--mono);
        font-size: 13.5px;
        background: #14110d;
        color: #f4ede2;
        border-radius: 12px;
        padding: 16px 18px;
        overflow-x: auto;
      }

      .terminal .prompt {
        color: var(--accent);
        user-select: none;
      }

      .card p {
        margin: 0;
        color: var(--ink-2);
        font-size: 14.5px;
      }

      /* ---------- architecture diagram ---------- */
      .pipeline {
        padding: 14px 0 8px;
      }

      .pipe-flow {
        display: flex;
        align-items: stretch;
        gap: 0;
        flex-wrap: wrap;
      }

      .node {
        flex: 1 1 0;
        min-width: 150px;
        background: var(--bg-panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 16px 16px 18px;
        box-shadow: var(--shadow-sm);
        position: relative;
      }

      .node .svc {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--accent-ink);
        margin-bottom: 6px;
        font-family: var(--mono);
      }

      .node .title {
        font-weight: 640;
        font-size: 15px;
        margin-bottom: 4px;
      }

      .node .desc {
        font-size: 13px;
        color: var(--muted);
      }

      .arrow {
        flex: 0 0 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--accent);
        font-size: 18px;
      }

      .pipe-base {
        margin-top: 14px;
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 13.5px;
        color: var(--muted);
        background: var(--bg-soft);
        border: 1px dashed var(--line-strong);
        border-radius: var(--radius);
        padding: 12px 16px;
      }

      .pipe-base b {
        color: var(--ink);
        font-family: var(--mono);
        font-size: 12.5px;
        font-weight: 700;
        letter-spacing: 0.03em;
      }

      /* ---------- sections ---------- */
      .section {
        padding: 70px 0;
        border-top: 1px solid var(--line);
      }

      .section-head {
        max-width: 640px;
        margin-bottom: 40px;
      }

      .section-eyebrow {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--accent-ink);
        margin-bottom: 12px;
      }

      .section-title {
        font-size: clamp(26px, 3.4vw, 36px);
        line-height: 1.12;
        letter-spacing: -0.02em;
        margin: 0;
        font-weight: 700;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 16px;
      }

      .feature {
        background: var(--bg-panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
        padding: 24px;
        transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
      }

      .feature:hover {
        border-color: var(--accent-line);
        box-shadow: var(--shadow);
        transform: translateY(-2px);
      }

      .feature .ficon {
        width: 38px;
        height: 38px;
        border-radius: 10px;
        background: var(--accent-soft);
        border: 1px solid var(--accent-line);
        display: flex;
        align-items: center;
        justify-content: center;
        margin-bottom: 16px;
        color: var(--accent-ink);
      }

      .ficon svg {
        width: 20px;
        height: 20px;
      }

      .feature h3 {
        font-size: 16.5px;
        margin: 0 0 8px;
        font-weight: 650;
        letter-spacing: -0.01em;
      }

      .feature p {
        margin: 0;
        font-size: 14.5px;
        color: var(--muted);
      }

      /* ---------- footer ---------- */
      .footer {
        border-top: 1px solid var(--line);
        padding: 30px 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        color: var(--muted);
        font-size: 14px;
      }

      .footer .nav a {
        color: var(--muted);
      }

      @media (max-width: 880px) {
        .hero {
          grid-template-columns: 1fr;
          gap: 36px;
          padding: 44px 0;
        }
        .nav {
          display: none;
        }
        .grid {
          grid-template-columns: 1fr;
        }
        .arrow {
          flex-basis: 100%;
          transform: rotate(90deg);
          padding: 4px 0;
        }
        .footer {
          flex-direction: column;
          gap: 12px;
        }
      }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="/"><span class="dot"></span>gitcask</a>
      <nav class="nav" aria-label="Primary">
        <a href="#how-it-works">How it works</a>
        <a href="#use-cases">Use cases</a>
        <a href="/health">Health</a>
      </nav>
      <a class="button primary nav-cta" href="#install">Deploy</a>
    </header>

    <main class="shell">
      <section class="hero">
        <div class="hero-copy">
          <span class="eyebrow">Mirror your GitHub repos to infrastructure you control</span>
          <h1>Your repos,<br /><span class="grad">your edge.</span></h1>
          <p class="lede">
            gitcask automatically mirrors your GitHub repositories to your own
            Cloudflare R2 storage — a backup that lives on infrastructure you own.
          </p>
          <div class="actions">
            <a class="button primary" href="#install">Get started &rarr;</a>
            <a class="button" href="#use-cases">View use cases</a>
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
          <div class="card" id="install">
            <div class="kicker">Deploy your own</div>
            <pre class="terminal"><span class="prompt">$</span> bun install &amp;&amp; bunx wrangler deploy</pre>
          </div>
          <div class="card">
            <div class="kicker">What it buys you</div>
            <p>
              Every backup is tracked as a job, every run keeps its history, and
              every artifact is checksummed in R2 — so you can see exactly what
              was mirrored and when.
            </p>
          </div>
        </div>
      </section>

      <section class="pipeline">
        <div class="pipe-flow">
          <div class="node">
            <div class="svc">github</div>
            <div class="title">Your repository</div>
            <div class="desc">Source of truth, polled on your schedule.</div>
          </div>
          <div class="arrow" aria-hidden="true">&rarr;</div>
          <div class="node">
            <div class="svc">worker + queues</div>
            <div class="title">Orchestration</div>
            <div class="desc">Schedules, dispatches, and completes backup jobs.</div>
          </div>
          <div class="arrow" aria-hidden="true">&rarr;</div>
          <div class="node">
            <div class="svc">container</div>
            <div class="title">Clone &amp; upload</div>
            <div class="desc">Isolated execution clones the repo and pushes it up.</div>
          </div>
          <div class="arrow" aria-hidden="true">&rarr;</div>
          <div class="node">
            <div class="svc">r2</div>
            <div class="title">Your mirror</div>
            <div class="desc">Checksummed artifacts in a bucket you own.</div>
          </div>
        </div>
        <div class="pipe-base">
          <span>State tracked in <b>D1</b> — every job, run, and artifact recorded as a real lifecycle.</span>
        </div>
      </section>

      <section id="how-it-works" class="section">
        <div class="section-head">
          <div class="section-eyebrow">How it works</div>
          <h2 class="section-title">A real job lifecycle, not a black-box cron.</h2>
        </div>
        <div class="grid">
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h6a3 3 0 0 1 3 3v6"/></svg></div>
            <h3>Atomic job flow</h3>
            <p>Schedule, dispatch, and complete backup jobs with explicit state transitions. Nothing relies on best-effort polling.</p>
          </article>
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/><path d="M12 8v4l3 2"/></svg></div>
            <h3>Versioned runs</h3>
            <p>Every backup run is preserved with timestamps, status, and error context for postmortems or replays.</p>
          </article>
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/></svg></div>
            <h3>Queue-backed execution</h3>
            <p>The worker orchestrates work, while the container handles cloning and upload with the right isolation boundary.</p>
          </article>
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/></svg></div>
            <h3>Change detection</h3>
            <p>Scheduled backups skip unchanged repos using GitHub's push timestamps, so you only store what actually moved.</p>
          </article>
        </div>
      </section>

      <section id="use-cases" class="section">
        <div class="section-head">
          <div class="section-eyebrow">Use cases</div>
          <h2 class="section-title">Reasons to keep a mirror you control.</h2>
        </div>
        <div class="grid">
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.4 3.9 5.6 3.9 9s-1.4 6.6-3.9 9c-2.5-2.4-3.9-5.6-3.9-9s1.4-6.6 3.9-9Z"/></svg></div>
            <h3>Off-GitHub copy</h3>
            <p>If GitHub is down or an account is locked, your mirror still lives in your own R2 bucket.</p>
          </article>
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg></div>
            <h3>Own your infrastructure</h3>
            <p>Your repos sit in R2 in your Cloudflare account — not a third-party backup vendor's.</p>
          </article>
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div>
            <h3>Hands-off &amp; scheduled</h3>
            <p>Point gitcask at a repo and it re-mirrors on your interval whenever the repo changes.</p>
          </article>
          <article class="feature">
            <div class="ficon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg></div>
            <h3>Quick setup</h3>
            <p>Cloudflare Workers, D1, R2, and Queues are the only moving parts. The rest is a straightforward admin API.</p>
          </article>
        </div>
      </section>
    </main>

    <footer class="footer shell">
      <div class="brand"><span class="dot"></span>gitcask</div>
      <div class="nav">
        <a href="/health">Health</a>
        <a href="/repos">API</a>
      </div>
    </footer>
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
