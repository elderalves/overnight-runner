# Overnight Runner

A provider-agnostic system for running a queue of unattended coding-agent sessions overnight, each in a clean conversational context, checkpointed with git commits.

## Language

**Job**:
A saved, self-contained task spec ready for unattended execution by one agent session.
_Avoid_: task, plan, ticket (a ticket belongs to the wayfinder map, not the runner); handoff (collides with the existing `handoff` and `andre-handoff` skills — different concepts, same word)

**Job status**:
A job's own persisted lifecycle state — pending, done, or blocked — carried on the job itself so a later run knows whether to run it again. Written exactly once, in `implement-overnight`'s final commit, from the job's OVERNIGHT_RESULT. A session that crashes or gets interrupted before that final commit never writes it at all — the field stays whatever it was (typically pending), so the job is automatically retried on a future run and resumes from its last checked-off checklist item, no human involved. This is distinct from a deliberate `blocked` write, which needs a manual reset before the job runs again.
_Avoid_: run outcome (that's a run summary's per-run view of a job, not the job's own persisted state); status (ambiguous with OVERNIGHT_RESULT and run outcome — say which one)

**Queue**:
The ordered list of jobs for one overnight run.
_Avoid_: batch, pipeline

**Run**:
One execution of the queue, start to finish.
_Avoid_: session (a session is a single agent's conversational context, scoped to one job)

**Target repo**:
The repo `overnight-runner` runs a queue against — `repo-path` on the CLI, defaulting to the current directory. Distinct from the runner's own repo, except when developing `overnight-runner` itself, where the two are the same and `jobs/`/`runs/` stay gitignored so dogfooding doesn't leak into the runner's own history.
_Avoid_: repo (ambiguous between this and the runner's own repo), working repo

**Base branch**:
The branch the run itself started on — what you were on when you kicked off the run, in the target repo.
_Avoid_: main branch, target branch

**Provider**:
A supported coding-agent CLI: Claude Code, Codex, or Copilot CLI.
_Avoid_: agent, model, tool

**Adapter**:
The runner's wrapper around invoking a specific provider's CLI, so the runner core doesn't care which provider is running.
_Avoid_: driver, plugin

**OVERNIGHT_RESULT**:
The machine-readable `PASS`/`BLOCKED` contract a skill emits at the end of a job, so the runner can decide what to do next without another LLM judging free text. The provider adapter can also *synthesize* a `BLOCKED` result on the skill's behalf — when the process exits non-zero, times out, or never emits the line at all — so the runner always receives a normalized contract even when a job's own emission fails.
_Avoid_: exit code, status (too generic — this is a specific emitted contract)

**Run outcome**:
How a run summary reports one job's result for that specific run: PASS or BLOCKED when the job executed (mirroring its OVERNIGHT_RESULT), SKIPPED when it was already done or blocked from an earlier run, or NOT RUN when the queue stopped before reaching it.
_Avoid_: job status (the job's own persisted field, not a run's report of it); result (too close to OVERNIGHT_RESULT, which is one execution's contract, not a run's report)

**Run summary**:
The generated, human-facing report of one run's outcome — one file per run — so Michael can review what happened at a glance without it becoming a second source of truth for job status.
_Avoid_: report, log (too generic — this is a specific per-run artifact); run state (the runner keeps no separate run-state file; resumability is job-status-driven)

**`implement-overnight`**:
A new skill, sibling to the existing `implement` skill, that adds the OVERNIGHT_RESULT contract and a deterministic test/review loop for unattended runs. The existing `implement` and `handoff` skills are not modified.

**Isolation mode**:
A per-job setting controlling what branch or worktree a job executes against. One of `inline`, `worktree`, or `chained`.

**Inline** (isolation mode):
The job runs directly on the base branch; its commit lands in the run's main sequence. The default isolation mode.
_Avoid_: default mode, direct mode

**Worktree** (isolation mode):
The job runs in a fresh git worktree on a new, dedicated branch; the base branch is untouched. Merging this branch back into the base branch is a separate, still-open decision — not something the job does implicitly.
_Avoid_: isolated mode, sandboxed mode

**Chained** (isolation mode):
The job runs on the branch a specific earlier job produced (via `worktree` or another `chained` job), referenced by that job's name — extending that branch's lineage directly, never merging it into the base branch.
_Avoid_: stacked, continued, dependent mode
