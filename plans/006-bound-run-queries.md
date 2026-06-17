# Plan 006: Bound the run queries — SQL-side latest-run lookup, ordered/limited run lists, cheap cooldown check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- src/routes/repos.ts test/api.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (changes list-response ordering; adds a default limit to one endpoint)
- **Depends on**: plans/001-verification-baseline.md. If plan 005 runs first, re-read the trigger endpoint before editing (both plans touch `src/routes/repos.ts`; non-overlapping line ranges, but verify).
- **Category**: perf
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

Three queries in `src/routes/repos.ts` fetch entire run histories where one row (or a bounded page) is needed. Runs accumulate per backup attempt and are retained for 180 days (`src/services/retention.ts`), so with, say, 50 repos backing up hourly, `GET /repos` drags ~hundreds of thousands of rows out of D1 and joins them in Worker memory **on every call** — cost grows linearly with history, forever. The fixes are query-shape changes with no response-schema changes (one endpoint gains ordering + an optional `limit` param).

## Current state

- `src/routes/repos.ts:122-161` — `GET /repos` fetches all repos, then **all runs for those repos** (only 5 columns, but every row):

```ts
// src/routes/repos.ts:142-151
const runs = await db
  .select({
    repo_id: schema.runs.repo_id,
    status: schema.runs.status,
    started_at: schema.runs.started_at,
    finished_at: schema.runs.finished_at,
    error: schema.runs.error,
  })
  .from(schema.runs)
  .where(inArray(schema.runs.repo_id, repoIds));
```

then reduces to latest-per-repo in JS via `latestRunByRepo(runs)` (lines 80–120, a Map keyed by `repo_id` keeping the max `started_at`). The response attaches `last_run: {status, started_at, finished_at, error} | null` to each repo.

- `src/routes/repos.ts:300-311` — the trigger cooldown fetches **all completed runs** for the repo and filters in JS:

```ts
// src/routes/repos.ts:301-311
const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const recentRuns = await db
  .select()
  .from(schema.runs)
  .where(
    and(eq(schema.runs.repo_id, id), eq(schema.runs.status, "completed"))
  );
const hasRecentSuccess = recentRuns.some(
  (r) => r.finished_at && r.finished_at > fiveMinAgo
);
```

- `src/routes/repos.ts:353-373` — `GET /repos/:id/runs` returns every run for the repo, unordered and unbounded.
- Drizzle is used everywhere (`drizzle-orm/d1`); raw SQL is available via the `sql` template + `db.all(...)`. Timestamps are ISO-8601 TEXT columns, so lexicographic `MAX()`/`ORDER BY` is chronologically correct.
- SQLite guarantee you will rely on: with `GROUP BY` + a bare `MAX()` aggregate, the non-aggregate columns come **from the row that achieved the max** (documented SQLite behavior since 3.7.11).
- Tests: `test/api.test.ts` has `describe("GET /repos")` including "includes the latest run per repo" (inserts two runs, asserts the newer one is returned). That test is the regression net for Step 1.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Install   | `bun install`                        | exit 0              |
| Typecheck | `bun run typecheck`                  | exit 0              |
| Tests     | `bun run test`                       | all pass            |
| One file  | `bunx vitest run test/api.test.ts`   | file passes         |
| Lint      | `bun run check`                      | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `src/routes/repos.ts`
- `test/api.test.ts`

**Out of scope** (do NOT touch):
- The response **shape** of `GET /repos` (`last_run` object with those 4 fields, or null) — the CLI (`cli/format.ts`) renders it.
- `src/routes/jobs.ts` (`GET /jobs`) — already bounded: it only returns active (queued/running) jobs.
- `src/routes/runs.ts` (`GET /runs/:id`) — single-run fetch, already fine.
- `src/services/retention.ts` — already batched.
- Adding offset-based pagination — deliberately not done (no client needs it; a `limit` param is enough for now).

## Git workflow

- Branch: `perf/006-bound-run-queries`
- Commit style: conventional commits, e.g. `perf: compute latest run per repo in SQL and bound run queries`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Latest-run-per-repo in SQL

In `GET /repos`, replace the all-runs fetch + `latestRunByRepo` call with a single grouped query using drizzle's `sql` template (import `sql` from `drizzle-orm`):

```ts
const latestRows = await db.all<{
  repo_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}>(sql`
  SELECT repo_id, status, MAX(started_at) AS started_at, finished_at, error
  FROM runs
  WHERE repo_id IN ${repoIds}
  GROUP BY repo_id
`);
const latestRuns = new Map(
  latestRows.map((r) => [
    r.repo_id,
    { status: r.status, started_at: r.started_at, finished_at: r.finished_at, error: r.error },
  ])
);
```

Note: drizzle's `sql` template expands an array binding `IN ${repoIds}` into a parenthesized parameter list; if your drizzle version does not, use `sql.join` or fall back to `inArray` inside a subquery — the deliverable is one grouped query, not a specific helper. Delete the now-unused `latestRunByRepo` function (lines 80–120) and any imports it alone used.

**Verify**: `bunx vitest run test/api.test.ts` → the existing "includes the latest run per repo" test passes unchanged.

### Step 2: Cheap cooldown check

Replace the fetch-all-completed-runs block in the trigger handler with an existence query (import `gt` from drizzle-orm):

```ts
const [recentSuccess] = await db
  .select({ id: schema.runs.id })
  .from(schema.runs)
  .where(
    and(
      eq(schema.runs.repo_id, id),
      eq(schema.runs.status, "completed"),
      gt(schema.runs.finished_at, fiveMinAgo)
    )
  )
  .limit(1);
if (recentSuccess) { /* existing 429 response, unchanged */ }
```

(SQL `>` on a NULL `finished_at` is falsy, matching the old `r.finished_at &&` guard.)

**Verify**: `bun run typecheck` → exit 0; existing trigger tests in `test/api.test.ts` pass.

### Step 3: Order and bound `GET /repos/:id/runs`

In the runs-list handler, add ordering and an optional `limit` query param (default 50, max 200), newest first (import `desc` from drizzle-orm):

```ts
const limitParam = Number(c.req.query("limit") ?? 50);
if (!Number.isInteger(limitParam) || limitParam < 1 || limitParam > 200) {
  return c.json({ error: "limit must be an integer between 1 and 200" }, 400);
}
const results = await db
  .select()
  .from(schema.runs)
  .where(eq(schema.runs.repo_id, id))
  .orderBy(desc(schema.runs.started_at))
  .limit(limitParam);
```

**Behavior change to flag in your report**: responses are now newest-first and capped at 50 by default (previously: all rows, insertion order). The CLI (`cli/commands/runs.ts`) renders whatever list it gets — no CLI change needed.

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Tests

In `test/api.test.ts`:
1. **latest-run with interleaved repos** — two repos, two runs each with interleaved `started_at` values; `GET /repos` returns each repo's own newest run (catches GROUP BY mistakes the existing single-repo test wouldn't).
2. **runs list ordered and limited** — one repo, 3 runs with distinct `started_at`; `GET /repos/:id/runs?limit=2` → 200, exactly 2 rows, newest first; `?limit=0` → 400; no param → all 3, newest first.
3. **cooldown still enforced** — repo with a completed run `finished_at` 1 minute ago → trigger returns 429; with `finished_at` 10 minutes ago → trigger returns 202. (If an equivalent test already exists, extend rather than duplicate.)

**Verify**: `bunx vitest run test/api.test.ts` → all pass including new tests.

### Step 5: Full gate

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0.

## Test plan

See Step 4; pattern: existing `GET /repos` tests in `test/api.test.ts` (raw `env.DB.prepare` inserts, `makeRequest`, assert JSON body).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "latestRunByRepo" src/routes/repos.ts` returns no matches
- [ ] `grep -n "GROUP BY repo_id" src/routes/repos.ts` returns a match
- [ ] `grep -n "limit" src/routes/repos.ts` shows the runs-list limit logic
- [ ] `bun run test` exits 0 including the new tests
- [ ] `bun run typecheck` and `bun run check` exit 0
- [ ] Only the two in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The grouped query returns wrong rows in the interleaved-repos test and you cannot fix it within the bare-column-MAX approach — do not silently revert to the in-memory join.
- `db.all` with the `sql` template is unavailable in the installed drizzle version and no equivalent exists.
- `src/routes/repos.ts` has materially changed in the trigger handler region (plan 005 may have landed) and the cooldown block no longer matches the excerpt — re-read, and only proceed if the cooldown logic is still recognizably the same.

## Maintenance notes

- If true pagination is ever needed, add a `before=<started_at>` cursor to `GET /repos/:id/runs` rather than offset (stable under inserts).
- The grouped latest-run query scans the runs table per request; if `GET /repos` becomes hot, add an index on `runs(repo_id, started_at)` — flag for a future migration, not done here.
- Reviewer focus: NULL `finished_at` handling in the cooldown (Step 2) and tie-breaking when two runs share `started_at` (bare-column MAX picks one arbitrarily — acceptable, they'd be the same backup attempt).
