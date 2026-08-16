# Run Claude Code and Copilot CLI jobs with full permission bypass, not scoped sandboxing

For the overnight runner to execute unattended, every provider CLI must run with zero interactive prompts. Codex offers a properly scoped `--sandbox workspace-write` mode for this, but Claude Code and Copilot CLI don't — their only confirmed zero-prompt mechanisms are full bypass flags (`--dangerously-skip-permissions` for Claude Code, `--allow-all-tools --no-ask-user` for Copilot CLI). Neither offers a middle ground between "prompts" and "bypasses everything." We're accepting that risk for these two providers rather than inventing a narrower guardrail, relying on the runner's existing isolation-mode and failure-policy machinery (worktree/chained jobs land on disposable branches; an inline job's `BLOCKED` result stops the run entirely) as the risk control instead.

Decided while resolving [Provider adapter contract per CLI](../../.alves/issues/provider-adapter-contract.md) (see `.alves/` — local, gitignored issue tracker).

## Considered options

- **Restrict Claude Code / Copilot CLI jobs to `worktree`/`chained` isolation only**, so bypass-mode blast radius never touches the base branch directly. Rejected: isolation mode is already a per-job, per-user choice made by [Isolation-mode mechanics](../../.alves/issues/isolation-mode-mechanics.md) and [Queue format & failure policy](../../.alves/issues/queue-format-and-failure-policy.md) — re-litigating it here would duplicate that decision rather than add a new one.
- **Accept full bypass, unconditionally.** Chosen — see above.

## Consequences

- A misbehaving job on either provider can take any action a fully-trusted local session could (file deletion, arbitrary shell commands, network calls) with no per-tool scoping.
- `--dangerously-skip-permissions` has one reported case (GitHub issue #52506) of a one-time blocking acceptance dialog on a machine with no prior acceptance cache — not reproduced in testing (Claude Code `2.1.233`), but worth a smoke-test on the actual overnight-run host before the first real run.
- If Claude Code or Copilot CLI later ship a scoped sandbox mode comparable to Codex's `--sandbox workspace-write`, this decision should be revisited.
