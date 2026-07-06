# Runtime & Tooling (Bun)

This project runs on Cloudflare Workers (Hono + D1/drizzle + R2 + Queues + Durable Objects), deployed via `wrangler`. Bun is used locally for the CLI (`bin/gitcask` → `cli/index.ts`) and as the package manager, not as the production runtime — so default to Bun for local tooling instead of Node.js, but don't reach for `Bun.serve()`, `bun:sqlite`, `Bun.redis`, or `Bun.sql`.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>` (e.g. running the CLI)
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa

Tests run via `vitest` (`bun test` doesn't work here — `@cloudflare/vitest-pool-workers` is required to run tests inside the Workers runtime).

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `bun x ultracite fix`
- **Check for issues**: `bun x ultracite check`
- **Diagnose setup**: `bun x ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `bun x ultracite fix` before committing to ensure compliance.

# Agent skills

### Issue tracker

Issues live in GitHub Issues (nbbaier/gitcask), managed via the `gh` CLI. External PRs are not treated as a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

All five triage roles use their default label names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`); `wontfix` and `ready-for-agent` already exist as GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` and `docs/adr/` at the repo root (not created yet; skills create them lazily). See `docs/agents/domain.md`.

## Learned User Preferences

- When iterating on landing page layout, preserve production files and apply experiments in cloned variants (e.g. `index-alt.html`)
- Prefer semantic landing markup: all page sections inside `<main>`, full-bleed section backgrounds (`.field`) with inner content constrained by `.shell`

## Learned Workspace Facts

- `wrangler dev` requires Docker with Buildx because the worker defines a container binding (`BackupContainer`, image `./container/Dockerfile`)
- Local Docker runs via OrbStack; active context should be `orbstack`, and `docker-buildx` must be available (Homebrew plugin path in `~/.docker/config.json` `cliPluginsExtraDirs`)
- Static landing page sources live under `src/landing/` (e.g. `index.html`, `index-alt.html` with paired CSS files)
