import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as git from './git.ts';

export interface Adapter {
  skillToken: string;
  command: string;
  baseArgs: string[];
}

// Table-driven adapter per .alves/issues/provider-adapter-contract.md.
// Adding a provider later means adding one row here -- no other file changes.
const ADAPTERS: Record<string, Adapter> = {
  claude: {
    skillToken: '/',
    command: 'claude',
    baseArgs: ['-p', '--dangerously-skip-permissions'],
  },
  codex: {
    // $-invocation is the CLI-guaranteed deterministic form; /-invocation is only a
    // model choosing to go read the SKILL.md, not a headless guarantee. See
    // .alves/issues/validate-codex-headless-skill-invocation.md.
    skillToken: '$',
    command: 'codex',
    baseArgs: ['exec', '--ephemeral', '--sandbox', 'workspace-write'],
  },
  copilot: {
    skillToken: '/',
    command: 'copilot',
    baseArgs: ['-p', '--no-ask-user', '--allow-all-tools'],
  },
};

const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
// A few seconds, per the design conversation behind CONTEXT.md's "Activity" --
// tight enough that a stalled-looking job doesn't sit quiet, loose enough
// that a `git status` shell-out per running job stays cheap.
const ACTIVITY_INTERVAL_MS = 4 * 1000;

function adapterFor(providerName: string | undefined): Adapter {
  const adapter = providerName === undefined ? undefined : ADAPTERS[providerName];
  if (!adapter) {
    throw new Error(`unknown provider "${providerName}" (known: ${Object.keys(ADAPTERS).join(', ')})`);
  }
  return adapter;
}

// jobFilePath is always an absolute path into the *base* repo's jobs/ dir --
// jobs/ is gitignored, so it doesn't exist inside a worktree/chained job's
// checkout, and a path relative to that cwd would resolve nowhere.
function buildPrompt(providerName: string | undefined, jobFilePath: string): string {
  const adapter = adapterFor(providerName);
  return `${adapter.skillToken}implement-overnight ${jobFilePath}`;
}

const RESULT_LINE = /^OVERNIGHT_RESULT:\s*(PASS|BLOCKED)\s*$/;
const REASON_LINE = /^REASON:\s*(.+)$/;

export interface ParsedResult {
  result: 'PASS' | 'BLOCKED';
  reason: string;
}

// Scans for the *last* matching line (in case the token appears earlier in the
// model's own reasoning/quoted text), then applies the exit-code override.
function parseResult(stdout: string, exitCode: number | null): ParsedResult {
  const lines = stdout.split('\n');
  let result: 'PASS' | 'BLOCKED' | null = null;
  let reason = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(RESULT_LINE);
    if (m) {
      result = m[1] as 'PASS' | 'BLOCKED';
      reason = '';
      if (result === 'BLOCKED') {
        const next = lines[i + 1] || '';
        const rm = next.match(REASON_LINE);
        if (rm) reason = rm[1]!.trim();
      }
    }
  }
  if (result === null) {
    return { result: 'BLOCKED', reason: `no OVERNIGHT_RESULT emitted (exit ${exitCode})` };
  }
  // Only a PASS-shaped line needs overriding -- a BLOCKED line already agrees
  // with a non-zero exit, so its own reason is more informative than the
  // generic override text.
  if (result === 'PASS' && exitCode !== 0) {
    return { result: 'BLOCKED', reason: `process exited non-zero (exit ${exitCode}), overriding emitted result` };
  }
  return { result, reason };
}

const PHASE_LINE = /^OVERNIGHT_PHASE:\s*(.+)$/;
const NOTE_LINE = /^OVERNIGHT_NOTE:\s*(.+)$/;

export interface SentinelMatch {
  type: 'phase' | 'note';
  value: string;
}

// Recognizes exactly the two live-progress sentinels, same "thin runner"
// contract as OVERNIGHT_RESULT/REASON above: a bounded, well-known marker,
// never the surrounding prose. Exported for unit testing.
function matchSentinelLine(line: string): SentinelMatch | null {
  const phase = line.match(PHASE_LINE);
  if (phase) return { type: 'phase', value: phase[1]!.trim() };
  const note = line.match(NOTE_LINE);
  if (note) return { type: 'note', value: note[1]!.trim() };
  return null;
}

// Buffers a still-running child process's stdout chunks into complete lines
// as they arrive, so sentinels can be scanned live instead of only once at
// close (OVERNIGHT_RESULT's own full-buffer scan in parseResult() is
// untouched -- this is additive). Exported for unit testing.
class LineBuffer {
  private pending = '';

  push(chunk: string): string[] {
    this.pending += chunk;
    const parts = this.pending.split('\n');
    this.pending = parts.pop() ?? '';
    return parts;
  }

  // Call once the source has ended: whatever's left wasn't newline-terminated
  // but is still a complete final line (e.g. the child's very last write, with
  // no trailing newline before exit) -- without this, that line would never
  // be scanned for a sentinel.
  flush(): string[] {
    if (!this.pending) return [];
    const last = this.pending;
    this.pending = '';
    return [last];
  }
}

// Tracks the last-reported ActivityInfo so an unchanged poll never re-fires --
// see ACTIVITY_INTERVAL_MS's comment. Exported for unit testing.
class ActivityTracker {
  private last: ActivityInfo | null = null;

  // Returns info only the first time it's seen (a new top file from `git
  // status`, or the changed-file count moves); null on a repeat or a clean
  // tree.
  report(info: ActivityInfo | null): ActivityInfo | null {
    if (!info) return null;
    if (info.file === this.last?.file && info.changedCount === this.last?.changedCount) return null;
    this.last = info;
    return info;
  }
}

export interface ActivityInfo {
  file: string;
  changedCount: number;
}

// Generic, skill-agnostic liveness fallback: the most recently listed
// changed/untracked file in the job's own worktree, per `git status
// --porcelain`. Works for any job regardless of whether it emits any
// sentinel at all. Returns null on a clean tree or a git failure (e.g. cwd
// removed mid-teardown race). Exported for unit testing.
function detectActivity(cwd: string): ActivityInfo | null {
  const lines = git.statusPorcelain(cwd);
  if (lines.length === 0) return null;
  // Porcelain format is "XY path" (or "XY orig -> path" for renames) --
  // strip the two-status-char + space prefix.
  return { file: lines[0]!.slice(3).trim(), changedCount: lines.length };
}

export interface ProviderResult {
  result: 'PASS' | 'BLOCKED';
  reason: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  // True only when `signal` fired -- a deliberate serve-mode Cancel, distinct
  // from a timeout, so the caller can force an explicit "blocked" write
  // instead of the free crash-equivalent pending/auto-retry a timeout gets.
  // See .alves/issues/overnight-runner-web-interface/run-control-semantics.md.
  cancelled: boolean;
}

// Runs one provider CLI to completion, always resolving (never rejecting) with a
// normalized {result, reason, exitCode, stdout, stderr} -- crash, timeout, and a
// clean BLOCKED verdict all end up as the same shape for the runner to record.
function runProvider(
  providerName: string | undefined,
  prompt: string,
  cwd: string,
  {
    timeoutMs,
    logPath,
    onHeartbeat,
    onPhase,
    onNote,
    onActivity,
    signal,
  }: {
    timeoutMs?: number;
    logPath?: string;
    onHeartbeat?: (elapsedMs: number, timeoutMs: number) => void;
    onPhase?: (phase: string) => void;
    onNote?: (note: string) => void;
    onActivity?: (info: ActivityInfo) => void;
    signal?: AbortSignal;
  } = {}
): Promise<ProviderResult> {
  const adapter = adapterFor(providerName);
  const effectiveTimeout = timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise<ProviderResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(adapter.command, [...adapter.baseArgs, prompt], { cwd });
    } catch (err) {
      resolve({ result: 'BLOCKED', reason: `failed to launch ${adapter.command}: ${(err as Error).message}`, exitCode: null, stdout: '', stderr: '', cancelled: false });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let cancelled = false;
    const startedAt = Date.now();

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, effectiveTimeout);

    const onAbort = () => {
      cancelled = true;
      child.kill('SIGKILL');
    };
    signal?.addEventListener('abort', onAbort);

    const heartbeat = onHeartbeat
      ? setInterval(() => onHeartbeat(Date.now() - startedAt, effectiveTimeout), HEARTBEAT_INTERVAL_MS)
      : null;

    const activityTracker = new ActivityTracker();
    const activityTimer = onActivity
      ? setInterval(() => {
          const info = activityTracker.report(detectActivity(cwd));
          if (info) onActivity(info);
        }, ACTIVITY_INTERVAL_MS)
      : null;

    const lineBuffer = new LineBuffer();

    child.stdout!.on('data', (chunk) => {
      const text = String(chunk);
      stdout += text;
      if (!onPhase && !onNote) return;
      for (const line of lineBuffer.push(text)) {
        const match = matchSentinelLine(line);
        if (!match) continue;
        if (match.type === 'phase') onPhase?.(match.value);
        else onNote?.(match.value);
      }
    });
    child.stderr!.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (activityTimer) clearInterval(activityTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ result: 'BLOCKED', reason: `provider process error: ${err.message}`, exitCode: null, stdout, stderr, cancelled: false });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (activityTimer) clearInterval(activityTimer);
      signal?.removeEventListener('abort', onAbort);

      if (onPhase || onNote) {
        for (const line of lineBuffer.flush()) {
          const match = matchSentinelLine(line);
          if (!match) continue;
          if (match.type === 'phase') onPhase?.(match.value);
          else onNote?.(match.value);
        }
      }

      if (logPath) {
        try {
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          fs.writeFileSync(
            logPath,
            `$ ${adapter.command} ${adapter.baseArgs.join(' ')} <prompt>\ncwd: ${cwd}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`
          );
        } catch (err) {
          console.error(`warning: failed to write log ${logPath}: ${(err as Error).message}`);
        }
      }

      if (cancelled) {
        resolve({ result: 'BLOCKED', reason: 'cancelled by user', exitCode: null, stdout, stderr, cancelled: true });
        return;
      }

      if (timedOut) {
        resolve({ result: 'BLOCKED', reason: 'timed out and was killed', exitCode: 124, stdout, stderr, cancelled: false });
        return;
      }

      const parsed = parseResult(stdout, code);
      resolve({ ...parsed, exitCode: code, stdout, stderr, cancelled: false });
    });
  });
}

export { ADAPTERS, buildPrompt, parseResult, matchSentinelLine, LineBuffer, ActivityTracker, detectActivity, runProvider, DEFAULT_TIMEOUT_MS };
