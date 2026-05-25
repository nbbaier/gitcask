# In-flight Jobs are surfaced separately from Outcomes

The `runs` table (an **Outcome**, despite the legacy name — see
[CONTEXT.md](../../CONTEXT.md)) is written only when a Job reaches a terminal
state. In-flight Jobs have no Outcome row, so `/runs` cannot answer "what
is this job doing right now?"

The API keeps two distinct surfaces: `/jobs` for in-flight (and recently
cancelled / failed but not-yet-aged-out) Jobs, and `/runs` for the
finalized Outcome history. Both already exist; the observability work
extends `/jobs/:id` with `job_events` and a derived `is_stale` flag rather
than introducing new routes.

The alternative — collapsing both into one endpoint, or retrofitting
`/runs` to also serve in-flight state — was rejected because it would
conflate two different concepts (the durable Outcome record that parents
Artifacts, vs. the live Job that may still change). Keeping them separate
keeps each surface honest about what it returns and what guarantees it
provides.
