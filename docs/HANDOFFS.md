# Open Handoffs

Follow-up threads scoped out of the
[backup observability plan](./plans/BACKUP_OBSERVABILITY_PLAN.md) review.
Each handoff is a self-contained briefing for a fresh agent to pick up.
They live in `$TMPDIR` (outside the repo) by design — they're scratch
artifacts, not committed plans.

| Topic | Path |
| --- | --- |
| Multi-instance container parallelism | `$TMPDIR/handoff-backup-container-parallelism.md` |
| Rename `runs` table to `outcomes` (domain model) | `$TMPDIR/handoff-runs-vs-outcome-domain-model.md` |
| Container startup recovery for in-flight Jobs | `$TMPDIR/handoff-container-restart-recovery.md` |
| Propagate cancellation into a running container | `$TMPDIR/handoff-container-cancellation-propagation.md` |

On macOS, `$TMPDIR` typically resolves to something like
`/var/folders/.../T/`. Run `echo "$TMPDIR"` to get the actual path.

These files are not durable — they may be cleaned up by the OS. If you
need a handoff to survive long-term, move it into `docs/plans/` or open
an issue from it.
