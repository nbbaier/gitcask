# Plan 008: Input and auth hardening — timing-safe token check, interval upper bound, owner/name format validation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat feed787..HEAD -- src/lib/auth.ts src/routes/repos.ts test/api.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-verification-baseline.md. Coordinate with plans 005/006 (all touch `src/routes/repos.ts` — land this after them or rebase carefully).
- **Category**: security
- **Planned at**: commit `feed787`, 2026-06-10

## Why this matters

Three defense-in-depth gaps, none independently urgent, bundled because they're each a few lines: (1) the admin bearer token is compared with `!==`, which is not constant-time — a narrow but standard hardening fix; (2) `interval_minutes` has a lower bound (≥5) but no upper bound, so date arithmetic can be pushed to absurd values; (3) repo `owner`/`name` flow into R2 object keys (`repos/${owner}/${name}/...` — see `src/services/backup-dispatcher.ts:26`) and a git clone URL with only "non-empty" validation. GitHub's own naming rules make traversal impossible **today** (the create route also validates against the GitHub API before inserting, `src/routes/repos.ts:42-46`), but the format check belongs at our boundary, not GitHub's.

## Current state

- `src/lib/auth.ts` (entire file, 17 lines):

```ts
// src/lib/auth.ts:8-16
const authHeader = c.req.header("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return c.json({ error: "Missing or invalid Authorization header" }, 401);
}
const token = authHeader.slice(7);
if (token !== c.env.ADMIN_TOKEN) {
  return c.json({ error: "Invalid token" }, 401);
}
await next();
```

- Runtime: Cloudflare Workers. `crypto.subtle.timingSafeEqual(a, b)` is available (a Workers-specific extension; both buffers must be the same byte length or it throws). The robust pattern is to SHA-256 both values first (equal-length digests, and length information is not leaked):

```ts
async function timingSafeStringEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  // @ts-expect-error timingSafeEqual is a Workers runtime extension
  return crypto.subtle.timingSafeEqual(da, db);
}
```

  (If TypeScript types for `timingSafeEqual` exist in the installed `@cloudflare/workers-types`, drop the suppression. Check first: `grep -rn "timingSafeEqual" node_modules/@cloudflare/workers-types/ | head -3`.)
- `src/routes/repos.ts:20-27` — POST /repos validation: non-empty owner/name; `interval < 5` rejected. `src/routes/repos.ts:185-190` — PATCH validates `interval_minutes < 5` only; `min_full_backup_days < 1` rejected at 196–201.
- GitHub naming rules (the validation target): owner (user/org login): alphanumeric and hyphens, no leading/trailing/double hyphen, max 39 chars. Repo name: alphanumeric, `.`, `_`, `-`, max 100 chars, and not `.` or `..`. A pragmatic boundary check:
  - owner: `/^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/`
  - name: `/^[a-zA-Z0-9._-]{1,100}$/` plus explicit rejection of `"."` and `".."`
- Tests: `test/api.test.ts` — `Auth` describe (401 cases) and `POST /repos` cases exist; the POST tests mock `globalThis.fetch` for the GitHub validation call (search for `validateGitHubRepoAccess` usage patterns — the tests mock fetch with a 200 to pass GitHub validation).
- Repo convention: top-level regex literals (Ultracite rule "use top-level regex literals") — define the two regexes as module-level constants.

## Commands you will need

| Purpose   | Command                            | Expected on success |
|-----------|------------------------------------|---------------------|
| Install   | `bun install`                      | exit 0              |
| Typecheck | `bun run typecheck`                | exit 0              |
| Tests     | `bun run test`                     | all pass            |
| One file  | `bunx vitest run test/api.test.ts` | file passes         |
| Lint      | `bun run check`                    | exit 0              |

## Scope

**In scope** (the only files you should modify):
- `src/lib/auth.ts`
- `src/routes/repos.ts` (POST `/` and PATCH `/:id` handlers only)
- `test/api.test.ts`

**Out of scope** (do NOT touch):
- `container/server.ts` — it receives owner/name only after Worker-side validation.
- The GitHub-API validation call (`validateGitHubRepoAccess`) — it stays; the regex is a pre-filter, not a replacement.
- Webhook URL validation (`WEBHOOK_URL` is operator-set config, not user input).

## Git workflow

- Branch: `security/008-input-auth-hardening`
- Commit style: conventional commits, e.g. `fix: timing-safe token comparison and stricter repo input validation`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Timing-safe comparison

In `src/lib/auth.ts`, add the `timingSafeStringEqual` helper from Current state (module-level, above `adminAuth`) and replace `if (token !== c.env.ADMIN_TOKEN)` with `if (!(await timingSafeStringEqual(token, c.env.ADMIN_TOKEN)))`. Response bodies and status codes unchanged.

**Verify**: `bunx vitest run test/api.test.ts` → existing Auth tests (valid token 200-path, missing token 401, wrong token 401) all pass.

### Step 2: Interval upper bound

In `src/routes/repos.ts`, extend both interval checks (POST line ~25, PATCH line ~186) to also reject `> 43200` (30 days):

```ts
const MAX_INTERVAL_MINUTES = 43_200; // 30 days
if (interval < 5 || interval > MAX_INTERVAL_MINUTES) {
  return c.json({ error: "interval_minutes must be between 5 and 43200" }, 400);
}
```

Apply the same bound and message in PATCH. Also add `!Number.isInteger(...)` to both checks (rejects `interval_minutes: 7.5` and `NaN`).

**Verify**: `bun run typecheck` → exit 0.

### Step 3: Owner/name format validation

In `src/routes/repos.ts`, add module-level regex constants (top-level literals per repo convention) and validate in POST `/` after the non-empty check, before the duplicate check:

```ts
const OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;
const REPO_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;
// in the handler:
if (!OWNER_PATTERN.test(body.owner) || !REPO_NAME_PATTERN.test(body.name) ||
    body.name === "." || body.name === "..") {
  return c.json({ error: "owner or name is not a valid GitHub identifier" }, 400);
}
```

**Verify**: `bun run typecheck` → exit 0.

### Step 4: Tests

In `test/api.test.ts`, extend the POST /repos and PATCH describes:

1. POST with `owner: "../../evil"` → 400 (and assert NO fetch to GitHub happened: the fetch mock's call count stays 0).
2. POST with `name: ".."` → 400.
3. POST with valid `owner: "nbbaier", name: "git.cask-2"` (dots/hyphens legal in names) → passes validation (existing mocked-GitHub 201 path).
4. POST with `interval_minutes: 100000` → 400; PATCH with `interval_minutes: 100000` → 400; POST with `interval_minutes: 7.5` → 400.
5. Auth regression: wrong-length token (e.g. `"x"`) → 401 (exercises the digest path with unequal inputs).

**Verify**: `bunx vitest run test/api.test.ts` → all pass including ~6 new tests.

### Step 5: Full gate

**Verify**: `bun run typecheck && bun run check && bun run test` → exit 0.

## Test plan

See Step 4. Pattern: existing POST /repos tests in `test/api.test.ts` (fetch mock for GitHub, `makeRequest`, body assertions).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "timingSafeEqual" src/lib/auth.ts` returns a match; `grep -n "token !== " src/lib/auth.ts` returns none
- [ ] `grep -n "OWNER_PATTERN" src/routes/repos.ts` returns matches at module level and in the POST handler
- [ ] `grep -n "43" src/routes/repos.ts` shows the upper bound in both POST and PATCH
- [ ] `bun run test` exits 0 including the new tests
- [ ] `bun run typecheck` and `bun run check` exit 0
- [ ] Only the three in-scope files modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `crypto.subtle.timingSafeEqual` throws or is undefined in the vitest-pool-workers runtime (the Workers extension should be present; if not, report — do NOT substitute a hand-rolled constant-time loop without review).
- Existing POST /repos tests use owner/name fixtures that the new regexes reject (e.g. names with spaces) — that means the fixtures, not the regexes, need changing; flag it if more than a couple of tests are affected.
- `src/routes/repos.ts` has drifted in the POST/PATCH handlers beyond plans 005/006's documented changes.

## Maintenance notes

- If GitHub Enterprise or non-GitHub remotes are ever supported, the regexes and the `github.com` clone URL both need revisiting — they encode GitHub naming rules.
- The validation regexes intentionally do not apply to PATCH (owner/name are immutable after creation — PATCH doesn't accept them).
- Reviewer focus: the `@ts-expect-error`/types interaction in Step 1 (use real types if `@cloudflare/workers-types` provides them) and that the 400 from Step 3 fires BEFORE any GitHub API call (no PAT-bearing request for garbage input).
