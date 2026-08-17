# Roadmap

Where `overnight-runner` is headed, and why. This is a snapshot, not a commitment — it
gets rewritten as problems actually surface, the same way every ticket in
[.alves/issues/](.alves/issues/) resolved toward "do the smaller thing" rather than
building ahead of a real need. See [CONTEXT.md](CONTEXT.md) for the glossary and
[.alves/issues/overnight-runner-build-spec.md](.alves/issues/overnight-runner-build-spec.md)
for the decision record behind the current `v0.1.0`.

## Now

### Real-time visibility into what a running job's agent is doing

**Problem:** The `serve` web UI (added after this roadmap's original "Progress feedback
during queue execution" item shipped) shows a job as `RUNNING` and a coarse
started/finished progress line, but nothing in between. For a job whose prompt points
at an external multi-step plan (e.g. a `handoff`), there's no way to tell which step is
in progress or whether it's still making progress at all — see
[CONTEXT.md](CONTEXT.md)'s "Phase" / "Activity note" / "Activity".

**Hypothesis:** `implement-overnight` self-reporting two new bounded sentinels —
`OVERNIGHT_PHASE:` (one of its own 8 fixed loop steps) and `OVERNIGHT_NOTE:` (a short
freeform checkpoint, emitted at its own discretion) — plus a generic, skill-agnostic
worktree-activity fallback (`git status --porcelain` polling), gives enough live signal
to answer "what is it doing, and is it progressing" without reopening the raw-streaming
question [Progress feedback during queue execution](.alves/issues/progress-feedback-during-run.md)
already closed. See [ADR 0003](docs/adr/0003-self-reported-progress-sentinels.md).

**How we'll know it worked:** Watching a running job in the `serve` UI shows its current
phase and periodic activity, instead of only a static "RUNNING" pill and a starting line.

**Rough size:** Medium — spans `contract`, `lib/providers.ts` (stdout handling changes
from buffer-then-parse-once to also scanning incrementally), `server/runState.ts`, and
`web`'s `JobDetail`. The `implement-overnight` skill-side emission is a separate
deliverable outside this repo.

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
