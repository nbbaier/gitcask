# gitcask

gitcask keeps point-in-time copies of GitHub repositories in Cloudflare R2, taken on a schedule or on demand, so a repo can be recovered if GitHub loses it.

## Language

### What gets backed up

**Repo**:
A GitHub repository, identified by owner and name, that gitcask has been told to back up.
_Avoid_: Project, source, tracked repository

**Backup**:
The act of copying a Repo's full Git history into storage. Every Backup is a complete copy; there are no incremental Backups.
_Avoid_: Full backup, sync, mirror

**Snapshot**:
The stored result of one successful Backup: a complete, timestamped copy of a Repo at that moment.
_Avoid_: Artifact, archive, tarball

**Snapshot metadata**:
The GitHub details about a Repo (description, topics, language, and so on) saved alongside each Snapshot.
_Avoid_: Sidecar, metadata file

**Latest pointer**:
The per-Repo record of which Snapshot is the most recent.
_Avoid_: Latest file, head

### When a Backup happens

**Trigger**:
What caused a Job to exist: either **scheduled** (gitcask decided it was time) or **manual** (an admin asked for it).
_Avoid_: Source, origin

**Interval**:
How often a Repo is considered for a scheduled Backup.
_Avoid_: Frequency, period

**Change detection**:
The check that skips a scheduled Backup when nothing has been pushed to the Repo since its last Backup.
_Avoid_: Diffing, dirty check

**Freshness window**:
The longest a Repo may go without a Backup. Once exceeded, a Backup happens even if Change detection found nothing new.
_Avoid_: Full backup interval, minimum full backup days

### Doing the work

**Job**:
One request to back up a Repo, from creation until it either completes or fails. A Job moves through **queued**, **running**, then **completed** or **failed**.
_Avoid_: Task, backup request

**Attempt**:
One try at carrying out a Job. A Job that fails is retried as a new Attempt until it succeeds or runs out of Attempts.
_Avoid_: Retry, execution

**Stage**:
The step a running Attempt is currently on: cloning, archiving, hashing, uploading, fetching metadata, or uploading metadata.
_Avoid_: Phase, step

**Deadline**:
The time by which a running Attempt must finish before gitcask treats it as failed.
_Avoid_: Timeout, TTL

**Cancel**:
An admin ending a Job early. A cancelled Job is a failed Job; there is no separate cancelled outcome.
_Avoid_: Abort, stop

**Run**:
The permanent record of how a Job ended: completed or failed, when it started and finished, and why it failed if it did. Each Job has at most one Run.
_Avoid_: Execution, attempt, history entry

### Keeping storage bounded

**Retention**:
The policy that decides which Snapshots and Runs are kept and which are deleted as they age.
_Avoid_: Cleanup, pruning, garbage collection
