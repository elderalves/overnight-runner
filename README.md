# overnight-runner

A thin, provider-agnostic runner for a queue of jobs. Each job runs in its own fresh Claude Code / Codex / Copilot CLI session and is checkpointed with git commits, so a whole queue can be kicked off and left to run unattended overnight.

> **Status:** early-stage (`v0.1.0`), unpublished, smoke-tested only. See [Known limitation](#known-limitation) below before you invest time in this.

## ⚠️ Warning: full permission bypass

Claude Code and Copilot CLI jobs run with **no per-tool scoping** — `--dangerously-skip-permissions` and `--allow-all-tools --no-ask-user` respectively. There's no confirmed middle ground between "prompts for every action" and "bypasses everything" for these two CLIs, so a misbehaving job can do anything a fully-trusted local session could: delete files, run arbitrary shell commands, make network calls. The runner's isolation modes (below) are the actual risk control — worktree/chained jobs land on disposable branches, and an inline job's `BLOCKED` result stops the whole run. Read [docs/adr/0001-permission-bypass-for-claude-and-copilot-cli.md](docs/adr/0001-permission-bypass-for-claude-and-copilot-cli.md) before pointing this at anything you care about.

## Known limitation

Running a job means invoking the `implement-overnight` skill (and its dependencies, `/tdd` and `/code-review`) headlessly through your provider CLI. These skills currently exist only in the author's personal Claude Code / Codex / Copilot setup — they are not vendored in this repo and are not published anywhere else. Cloning this repo is not, by itself, enough to execute a job end-to-end.

## Prerequisites

- Node.js >= 22.18.0 (the source is TypeScript, run directly via Node's native type-stripping — see [docs/adr/0002](docs/adr/0002-adopt-typescript-via-node-native-type-stripping.md))
- git
- One provider CLI installed and authenticated: `claude`, `codex`, or `copilot`
- The `implement-overnight` skill for your provider (see [Known limitation](#known-limitation))

## Install

```sh
git clone https://github.com/elderalves/overnight-runner.git
cd overnight-runner
npm install
npm link --workspace overnight-runner
```

This is an npm-workspaces monorepo ([ADR 0003](docs/adr/0003-adopt-npm-workspaces-react-vite-frontend-and-hono-backend.md)) — `npm install` at the root resolves all four packages, and `npm link` puts `overnight-runner` on your `PATH`, backed by [packages/overnight-runner/bin/overnight-runner.ts](packages/overnight-runner/bin/overnight-runner.ts).

## Tutorial: run your first queue

This walks through a full run against a throwaway repo, end to end.

### 1. Create a scratch target repo

```sh
mkdir /tmp/demo-repo && cd /tmp/demo-repo
git init -q
git commit -q --allow-empty -m "init"
```

### 2. Write your first job

Jobs live in a `jobs/` directory at the root of the target repo, one Markdown file per job.

```sh
mkdir jobs
cat > jobs/01-add-editorconfig.md <<'EOF'
---
status: pending
isolation: inline
---
Add an `.editorconfig` file to the repo root: UTF-8, LF line endings, 2-space
indent, insert a final newline.

- [ ] Create `.editorconfig` with the settings above
- [ ] Commit it
EOF
```

The YAML frontmatter is the job's configuration; the body is the spec the agent session works from, including an optional `- [ ]` checklist it checks off and commits incrementally.

### 3. Run the queue

```sh
overnight-runner /tmp/demo-repo
```

This loads every `jobs/*.md` file in order and, for each pending one, spawns a fresh provider CLI session running `/implement-overnight jobs/01-add-editorconfig.md`.

**If you have `implement-overnight` installed** for the provider you're using, that session actually implements the checklist, tests it, reviews it, and commits it.

**If you don't** — true for anyone but the author right now — the provider CLI still launches, but has no such skill to invoke. The runner detects the missing `OVERNIGHT_RESULT` line and records the job as `BLOCKED` with the reason `no OVERNIGHT_RESULT emitted`. That's expected given the [Known limitation](#known-limitation), not a bug in the runner itself.

### 4. Read the results

- **`runs/<timestamp>.md`** — the run summary: a totals line plus one row per job (status, duration, isolation mode, branch produced, provider, commit ref, notes).
- **`jobs/01-add-editorconfig.md`** — its `status:` frontmatter is flipped to `done` or `blocked`, and any checklist items completed before a crash stay checked off so a retry resumes instead of restarting.
- **`runs/<timestamp>/logs/01-add-editorconfig.log`** — the raw stdout/stderr from that job's provider CLI session.

### 5. Next steps

Try `--provider codex` or `--provider copilot`, or add a second job with `isolation: worktree` to see it land on its own `overnight/<identity>` branch instead of the target repo's base branch.

## CLI reference

```
overnight-runner [repo-path] [options]

Arguments:
  repo-path              Target repo to run against. Defaults to the current directory.

Options:
  --provider <name>       Default provider when a job has no provider frontmatter.
                          One of: claude, codex, copilot. Defaults to "claude".
  --timeout <minutes>     Per-job timeout, in minutes. Defaults to 60.
  -h, --help              Show help.
```

A job's own `provider:` frontmatter always wins over `--provider`.

## Web interface

```sh
npm run build -w web   # one-time (and after any packages/web change)
overnight-runner serve [repo-path] [--port <n>]
```

Boots a localhost-only browser control plane (no auth, no remote access) fronting the same queue engine as the plain CLI above: watch the queue live, author/edit/delete/duplicate/reset jobs, start/stop/cancel a run, and browse run history and settings. Binds to `127.0.0.1`, defaulting to port `4321` and scanning upward if that's busy. `serve` is purely additive — the one-shot CLI invocation documented above is unaffected.

## Job files

| Field | Required | Default | Meaning |
|---|---|---|---|
| `status` | no | `pending` | `pending` / `done` / `blocked` — the job's own persisted lifecycle state |
| `isolation` | no | `inline` | `inline` / `worktree` / `chained` — see below |
| `provider` | no | (uses `--provider`) | `claude` / `codex` / `copilot` |
| `chain_from` | only if `isolation: chained` | — | identity of the earlier job this one continues from |
| `slug` | no | filename minus `.md` | overrides the job's identity |

**Isolation modes:**

- **inline** — runs directly on the target repo's base branch; its commit lands in the run's main sequence. A `BLOCKED` inline job stops the run.
- **worktree** — runs in a fresh git worktree on a new `overnight/<identity>` branch; the base branch is untouched.
- **chained** — runs on the branch a specific earlier job produced (via `chain_from`), extending that branch's lineage.

For the full glossary — job status semantics, run outcomes, provider adapters, and more — see [CONTEXT.md](CONTEXT.md). For where this project is headed next, see [ROADMAP.md](ROADMAP.md).

## Development

```sh
npm test
```

Type-checks `packages/overnight-runner` (`tsc --noEmit`) and runs [packages/overnight-runner/test/smoke.ts](packages/overnight-runner/test/smoke.ts) against temporary repos — no target repo or provider CLI required. Run `npm run typecheck -w web` (or `-w contract` / `-w api-client`) to type-check the other workspace packages.

## License

`UNLICENSED` (all rights reserved) — see [package.json](package.json).
