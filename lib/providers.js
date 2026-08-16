'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Table-driven adapter per .alves/issues/provider-adapter-contract.md.
// Adding a provider later means adding one row here -- no other file changes.
const ADAPTERS = {
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

function adapterFor(providerName) {
  const adapter = ADAPTERS[providerName];
  if (!adapter) {
    throw new Error(`unknown provider "${providerName}" (known: ${Object.keys(ADAPTERS).join(', ')})`);
  }
  return adapter;
}

// jobFilePath is always an absolute path into the *base* repo's jobs/ dir --
// jobs/ is gitignored, so it doesn't exist inside a worktree/chained job's
// checkout, and a path relative to that cwd would resolve nowhere.
function buildPrompt(providerName, jobFilePath) {
  const adapter = adapterFor(providerName);
  return `${adapter.skillToken}implement-overnight ${jobFilePath}`;
}

const RESULT_LINE = /^OVERNIGHT_RESULT:\s*(PASS|BLOCKED)\s*$/;
const REASON_LINE = /^REASON:\s*(.+)$/;

// Scans for the *last* matching line (in case the token appears earlier in the
// model's own reasoning/quoted text), then applies the exit-code override.
function parseResult(stdout, exitCode) {
  const lines = stdout.split('\n');
  let result = null;
  let reason = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(RESULT_LINE);
    if (m) {
      result = m[1];
      reason = '';
      if (result === 'BLOCKED') {
        const next = lines[i + 1] || '';
        const rm = next.match(REASON_LINE);
        if (rm) reason = rm[1].trim();
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

// Runs one provider CLI to completion, always resolving (never rejecting) with a
// normalized {result, reason, exitCode, stdout, stderr} -- crash, timeout, and a
// clean BLOCKED verdict all end up as the same shape for the runner to record.
function runProvider(providerName, prompt, cwd, { timeoutMs, logPath } = {}) {
  const adapter = adapterFor(providerName);
  const effectiveTimeout = timeoutMs || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(adapter.command, [...adapter.baseArgs, prompt], { cwd });
    } catch (err) {
      resolve({ result: 'BLOCKED', reason: `failed to launch ${adapter.command}: ${err.message}`, exitCode: null, stdout: '', stderr: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, effectiveTimeout);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ result: 'BLOCKED', reason: `provider process error: ${err.message}`, exitCode: null, stdout, stderr });
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (logPath) {
        try {
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          fs.writeFileSync(
            logPath,
            `$ ${adapter.command} ${adapter.baseArgs.join(' ')} <prompt>\ncwd: ${cwd}\n\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`
          );
        } catch (err) {
          console.error(`warning: failed to write log ${logPath}: ${err.message}`);
        }
      }

      if (timedOut) {
        resolve({ result: 'BLOCKED', reason: 'timed out and was killed', exitCode: 124, stdout, stderr });
        return;
      }

      const parsed = parseResult(stdout, code);
      resolve({ ...parsed, exitCode: code, stdout, stderr });
    });
  });
}

module.exports = { ADAPTERS, buildPrompt, parseResult, runProvider, DEFAULT_TIMEOUT_MS };
