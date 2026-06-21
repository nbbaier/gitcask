# gitcask — project context & working brief

## The goal

Ship something by **June 30** that demonstrates the ability to **ship a real tool** — for the job search. This is a portfolio centerpiece, positioned on the exact thing being sold: Cloudflare edge architecture (Workers, D1, R2, Queues, containers).

"Ship" is defined tightly and must stay that way:

- Deployed and live.
- **One** working end-to-end demo path.
- A README a stranger can follow to deploy or try it.
- Landing page live (branding work already exists — capture it).
- A ~60-second demo video/gif embedded in the README.

Explicitly **not** the goal: a feature-complete SaaS, billing, multi-tenant polish, a dashboard. Those are "v2 / not now."

## Where things stand (as of June 18)

- **Phase 1 (into-md): DONE and shipped.** Live on npm at 1.0.1 — 39→74 tests, a real bug fixed, CI, MIT license, clean dist-only package, GitHub release with notes. This was the "guaranteed win" half of a deliberate barbell strategy, and it's banked. June 30 already has a finished, defensible, shipped tool on it.
- **Phase 2 (gitcask): NOT STARTED.** That's on schedule — it was never meant to begin before the state review. Its true state is UNKNOWN until `docs/gitcask-state-review.md` lands.
- **Time left:** ~12 days. **Capacity:** ~4 hrs/day.

## Strategy & guardrails (why gitcask, and how it goes wrong)

- gitcask is the _ambitious_ half of the barbell: the best demonstration of the edge architecture being sold, with prior branding/landing-page investment to capture.
- **Its main risk is scope creep** — it's the easiest project here to let balloon. So the definition of done must be frozen up front and defended.
- **A showable artifact beats a complete one.** A 60-second video of gitcask backing up a repo to R2 is worth more in an application than thousands of lines of perfect-but-invisible Worker code. Build toward a _demo_, not a green build.
- **Pace warning.** into-md shipped fast because it was ~90% done — the work was hardening, not building. gitcask is a genuine build (R2/Queues/D1 wiring). Do NOT plan at into-md velocity; the failure mode is assuming today's speed carries over.

## What gitcask is — PRIOR UNDERSTANDING, verify against the review

Treat everything here as unconfirmed until `gitcask-state-review.md` says otherwise:

- Encrypted Git backup to S3-compatible storage / Cloudflare R2, with Alchemy as IaC. Roughly: clone/mirror a repo, store it to R2; admin token + GitHub PAT for auth.
- There is an open positioning question: **encryption vs. mirroring** framing. The review should report what the code actually does today versus what the branding claims — this distinction may need resolving early, because it changes what the demo proves.

## The timeline skeleton (finalize this in the project)

The first move is **the spike**, not coding: read `gitcask-state-review.md`, then lock the ONE demo path and write an explicit out-of-scope list. That document is the single highest-leverage thing on the board — it's what stops scope creep from eating the month.

Suggested overall shape (to be dated and refined here):

1. **Spike** — pick the one demo path; freeze scope (in/out lists).
2. **Build the demo path** to working — the R2/Queues/D1 wiring is the risk zone.
3. **Hard go/no-go checkpoint around June 25** — if the end-to-end path isn't working by then, cut scope further (e.g. CLI-triggered demo instead of a hosted one) rather than push the deadline.
4. **Landing page live + README deploy guide + record the demo video.**
5. **Final ~2 days: harden and ship only — no new features.**

## The working pattern that succeeded with into-md (reuse it)

1. Inspect the real state before planning; don't trust the README.
2. Define "done" narrowly and freeze it.
3. Prepare changes as applyable patches.
4. Verify with real tooling (ran tests, ran `npm pack --dry-run` to confirm the published artifact) — don't assume config does what it says.
5. Keep publish/deploy/go-live as **human-run** steps. Agent work stops before the irreversible action with a clear "here are the commands to run" handoff.

## First tasks for this project

1. Read `docs/gitcask-state-review.md`.
2. Lock the definition of done: the one demo path + the out-of-scope list.
3. Produce the dated plan from today → June 30 at ~4 hrs/day, including the June 25 go/no-go checkpoint.
