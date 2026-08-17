import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

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
    signal,
  }: { timeoutMs?: number; logPath?: string; onHeartbeat?: (elapsedMs: number, timeoutMs: number) => void; signal?: AbortSignal } = {}
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

    child.stdout!.on('data', (chunk) => { stdout += chunk; });
    child.stderr!.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      signal?.removeEventListener('abort', onAbort);
      resolve({ result: 'BLOCKED', reason: `provider process error: ${err.message}`, exitCode: null, stdout, stderr, cancelled: false });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      signal?.removeEventListener('abort', onAbort);

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

export { ADAPTERS, buildPrompt, parseResult, runProvider, DEFAULT_TIMEOUT_MS };
