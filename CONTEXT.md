# Overnight Runner

A provider-agnostic system for running a queue of unattended coding-agent sessions overnight, each in a clean conversational context, checkpointed with git commits.

## Language

**Job**:
A saved, self-contained task spec ready for unattended execution by one agent session.
_Avoid_: task, plan, ticket (a ticket belongs to the wayfinder map, not the runner); handoff (collides with the existing `handoff` and `andre-handoff` skills — different concepts, same word)

**Queue**:
The ordered list of jobs for one overnight run.
_Avoid_: batch, pipeline

**Run**:
One execution of the queue, start to finish.
_Avoid_: session (a session is a single agent's conversational context, scoped to one job)

**Base branch**:
The branch the run itself started on — what you were on when you kicked off the run.
_Avoid_: main branch, target branch

**Provider**:
A supported coding-agent CLI: Claude Code, Codex, or Copilot CLI.
_Avoid_: agent, model, tool

**Adapter**:
The runner's wrapper around invoking a specific provider's CLI, so the runner core doesn't care which provider is running.
_Avoid_: driver, plugin

**OVERNIGHT_RESULT**:
The machine-readable `PASS`/`BLOCKED` contract a skill emits at the end of a job, so the runner can decide what to do next without another LLM judging free text.
_Avoid_: exit code, status (too generic — this is a specific emitted contract)

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
