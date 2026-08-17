# Self-reported Phase/Activity-note sentinels instead of raw stdout streaming

[Progress feedback during queue execution](.alves/issues/progress-feedback-during-run.md) deliberately
rejected streaming a job's raw provider-CLI stdout, specifically to avoid re-exposing
`implement-overnight`'s internal step-by-step chatter through the runner and keep the runner's own
knowledge "thin" (start time, timeout, outcome). That held as long as a job was atomic from the
runner's point of view. It stopped holding once a job's own prompt could point at an external,
multi-step plan (e.g. a `handoff`) — with no way to tell which step is in progress, "is it still
running?" is the only question the runner can answer.

We're revisiting that decision, but not reversing it: instead of raw streaming, `implement-overnight`
self-reports two new bounded, well-known lines — `OVERNIGHT_PHASE:` (one of its own 8 fixed loop
steps) and `OVERNIGHT_NOTE:` (a short freeform checkpoint, emitted at the skill's own discretion) —
the same shape as the existing `OVERNIGHT_RESULT`/`REASON:` contract. The runner still never parses
arbitrary output; it recognizes two more fixed markers. `lib/providers.ts` changes from buffering
stdout and parsing it once at close to *also* scanning it incrementally, line by line, as it arrives,
so these markers surface live instead of only at the end. A third, skill-agnostic signal (polling
`git status --porcelain` in the job's own worktree) provides a generic "still touching files"
fallback for jobs that never emit either sentinel.

## Considered options

- **Raw structured streaming** (e.g. `claude --output-format stream-json`, parsing tool-call events).
  Rejected — this is exactly what the prior decision ruled out, and it's provider-uneven today
  (Claude-only; Copilot CLI isn't even installed in this environment, Codex's streaming support here
  is unconfirmed).
- **Job-body checklist parsing only.** `implement-overnight` already checks off and commits
  `- [ ]` items in the job file itself, which the runner already owns and could read for free.
  Rejected as the *sole* mechanism: the motivating case's job body carries no checklist at all — it
  just names an external handoff directory — so this alone can't answer "which step."
- **Parsing the target repo's `handoff`-skill `index.html` status table directly.** Rejected — it
  couples the runner to an external, undocumented convention owned by a different skill, and
  `CONTEXT.md` already establishes that `handoff` is never modified to serve overnight-runner.
- **Self-reported sentinels + generic worktree-activity fallback (chosen).** Provider-agnostic (plain
  text matching, no CLI-specific flags), keeps the runner's parsing surface exactly as bounded as
  `OVERNIGHT_RESULT` already is, and degrades gracefully (to the worktree-activity signal alone) for
  any job or provider that never emits a phase or note.

## Consequences

- `implement-overnight` (`~/.claude/skills/implement-overnight/SKILL.md`) needs a corresponding update
  to actually emit `OVERNIGHT_PHASE`/`OVERNIGHT_NOTE` — that file lives outside this repo and is a
  separate deliverable. Until it ships, running jobs show only the generic worktree-activity fallback.
- `lib/providers.ts`'s child-process stdout handling now does two passes over the same data: the
  existing full-buffer-then-parse-once-at-close (unchanged, still backs `OVERNIGHT_RESULT`), plus a
  new incremental line-by-line scan for the two live sentinels. This is a real complexity increase,
  bounded to two fixed regexes.
- Phase/note/activity are explicitly live-only: present on a `Job` only while it's the one RUNNING
  this server session, cleared the instant it finishes, never written to a run summary or persisted
  anywhere. See `CONTEXT.md`'s "Phase" / "Activity note" / "Activity".
