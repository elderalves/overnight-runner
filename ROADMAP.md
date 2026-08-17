# Roadmap

Where `overnight-runner` is headed, and why. This is a snapshot, not a commitment — it
gets rewritten as problems actually surface, the same way every ticket in
[.alves/issues/](.alves/issues/) resolved toward "do the smaller thing" rather than
building ahead of a real need. See [CONTEXT.md](CONTEXT.md) for the glossary and
[.alves/issues/overnight-runner-build-spec.md](.alves/issues/overnight-runner-build-spec.md)
for the decision record behind the current `v0.1.0`.

## Now

### Progress feedback during queue execution

**Problem:** `overnight-runner /tmp/demo-repo` blocks silently. [bin/overnight-runner.ts](bin/overnight-runner.ts)
prints nothing until the run finishes — one line, the run summary path. Everything in
between (each job can run up to `--timeout`, 60 minutes by default) is a live process
with zero output, which is indistinguishable from a hang.

**Hypothesis:** Emitting a line per job-lifecycle event (job started, job finished with
outcome + duration) removes the "is this even running" uncertainty on long queues,
without turning the runner into something that needs its own UI.

**How we'll know it worked:** Running a multi-job queue shows visible progress in the
terminal as it happens, instead of silence followed by one line at the end.

**Rough size:** Small — the event points already exist in [lib/runner.ts](lib/runner.ts)'s
`run()`/`executeJob()` loop; this is wiring output to transitions that are already
tracked in the `Job` object, not new state.

**Before implementation starts, this needs its own ticket** (following this repo's own
`.alves/issues/` convention) to resolve:
1. **Grain** — a start/finish line per job, vs. streaming the provider CLI's own
   stdout live, vs. a periodic heartbeat/elapsed-time ticker while a single job is
   still mid-flight with no output of its own.
2. **Channel** — print directly to stdout, or point at the job's already-existing
   per-job log file (`.overnight-runner/runs/<id>/logs/<identity>.log`) for the user to `tail -f`
   themselves.
3. **Boundary** — this is progress *during* a run. It's adjacent to but distinct from
   [Run notification beyond files on disk](.alves/issues/run-notification-beyond-files.md),
   which closed "no active notification for v1" for run *completion*. That decision
   isn't being reopened here.

This roadmap entry says *what* and *why*; the *how* (phases, files touched, risks) is
a separate, not-yet-written implementation plan once the questions above are resolved.

## Next

Empty. There's no second committed initiative yet — this repo doesn't stage up
speculative work ahead of a real problem (see "Known but not scheduled" below for
things that were considered and deliberately left off). When something earns a spot
here, it lands first, then graduates to Now.

## Later

Empty, same reasoning as Next.

## Known but not scheduled

Not initiatives — visibility into gaps that exist today and were looked at, so the
absence here reads as a choice rather than an oversight.

- **Skill vendoring/publishing.** The [README's Known limitation](README.md#known-limitation):
  `implement-overnight` (and its dependencies `/tdd`, `/code-review`) live only in the
  author's personal Claude Code / Codex / Copilot setup. Cloning this repo isn't enough
  to run a job end-to-end. This is the actual blocker to anyone but Michael using the
  tool — not scheduled because there's no second user yet for whom it's the top problem.
- **Day-to-day job-authoring convention/skill.** Deferred in the original build spec —
  jobs are simple enough to hand-author directly against the schema fixed in
  [Job file format & location](.alves/issues/job-file-format.md).
- **Unattended execution/scheduling** (preventing Mac sleep, launchd/cron, self-hosted
  runner infra). Explicitly out of scope for v1 — today it's a shell command kicked off
  manually before bed.
- **Worktree/chained branch merge-back.** Not deferred — decided against, on purpose:
  [no auto-merge, ever, by design for v1](.alves/issues/branch-merge-back-policy.md).
  Listed here only so it doesn't look like an oversight; it isn't a future candidate
  unless that decision itself gets revisited.

## How this roadmap evolves

- Not a contract — a plan, redrawn when a Now item resolves or a new problem surfaces.
- New initiatives get resolved the way everything else in this repo has: explore the
  code, ask the open questions, write the answers down, then build. See
  [.alves/plan/](.alves/plan/) for that pattern in practice.
- The deeper decision record — every closed question that shaped `v0.1.0` — lives in
  [.alves/issues/](.alves/issues/); this file only tracks what's ahead.

---

_Sourced from [.alves/plan/03-roadmap-on-project.md](.alves/plan/03-roadmap-on-project.md)
(the request for this document) and
[.alves/plan/02-feedback-on-running.md](.alves/plan/02-feedback-on-running.md) (the one
initiative currently on it)._
