import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { readJobFile, writeStatus, identityFor } from '../lib/frontmatter.ts';
import { loadQueue } from '../lib/queue.ts';
import { parseResult, buildPrompt } from '../lib/providers.ts';
import * as runSummary from '../lib/runSummary.ts';
import * as runHistory from '../lib/runHistory.ts';
import * as progress from '../lib/progress.ts';
import { migrate } from '../lib/migrate.ts';
import { ServeState } from '../server/runState.ts';

let failures = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${name}`);
    console.error((err as Error).stack || (err as Error).message);
  }
}

function tmpRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-smoke-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'init']);
  fs.mkdirSync(path.join(dir, '.overnight-runner', 'jobs'), { recursive: true });
  return dir;
}

function writeJob(dir: string, file: string, frontmatter: Record<string, string>, body = 'Do the thing.\n'): void {
  const lines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push('---', '');
  fs.writeFileSync(path.join(dir, '.overnight-runner', 'jobs', file), lines.join('\n') + body);
}

// --- frontmatter ---

test('readJobFile parses scalar frontmatter and body', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-fm-'));
  const file = path.join(dir, 'job.md');
  fs.writeFileSync(file, '---\nisolation: worktree\nprovider: codex\n---\nBody text here.\n');
  const { frontmatter, body } = readJobFile(file);
  assert.strictEqual(frontmatter.isolation, 'worktree');
  assert.strictEqual(frontmatter.provider, 'codex');
  assert.strictEqual(body, 'Body text here.\n');
});

test('writeStatus replaces an existing status line without touching the rest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-fm-'));
  const file = path.join(dir, 'job.md');
  fs.writeFileSync(file, '---\nisolation: inline\nstatus: pending\n---\nBody.\n- [ ] step one\n');
  writeStatus(file, 'blocked');
  const { frontmatter, body } = readJobFile(file);
  assert.strictEqual(frontmatter.status, 'blocked');
  assert.strictEqual(frontmatter.isolation, 'inline');
  assert.strictEqual(body, 'Body.\n- [ ] step one\n');
});

test('writeStatus inserts status when absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-fm-'));
  const file = path.join(dir, 'job.md');
  fs.writeFileSync(file, '---\nisolation: inline\n---\nBody.\n');
  writeStatus(file, 'done');
  const { frontmatter } = readJobFile(file);
  assert.strictEqual(frontmatter.status, 'done');
});

test('identityFor prefers slug over filename', () => {
  assert.strictEqual(identityFor('01-add-retry.md', { slug: 'add-retry' }), 'add-retry');
  assert.strictEqual(identityFor('01-add-retry.md', {}), '01-add-retry');
});

// --- queue / chain_from validation ---

test('loadQueue skips done/blocked and defaults missing status to pending', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-a.md', { status: 'done' });
  writeJob(dir, '02-b.md', { status: 'blocked' });
  writeJob(dir, '03-c.md', {});
  const jobs = loadQueue(dir);
  assert.deepStrictEqual(jobs.map((j) => j.initialStatus), ['done', 'blocked', 'pending']);
});

test('chained job resolves branch through a valid worktree root', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-root.md', { isolation: 'worktree' });
  writeJob(dir, '02-next.md', { isolation: 'chained', chain_from: '01-root' });
  const jobs = loadQueue(dir);
  const chained = jobs.find((j) => j.identity === '02-next')!;
  assert.strictEqual(chained.resolvedBranch, 'overnight/01-root');
  assert.strictEqual(chained.blockedAtLoad, null);
});

test('multi-hop chain resolves to the original root, not the intermediate', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-root.md', { isolation: 'worktree' });
  writeJob(dir, '02-mid.md', { isolation: 'chained', chain_from: '01-root' });
  writeJob(dir, '03-leaf.md', { isolation: 'chained', chain_from: '02-mid' });
  const jobs = loadQueue(dir);
  const leaf = jobs.find((j) => j.identity === '03-leaf')!;
  assert.strictEqual(leaf.resolvedBranch, 'overnight/01-root');
});

test('chain_from targeting an inline job is BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-inline.md', {});
  writeJob(dir, '02-chained.md', { isolation: 'chained', chain_from: '01-inline' });
  const jobs = loadQueue(dir);
  const job = jobs.find((j) => j.identity === '02-chained')!;
  assert.strictEqual(job.status, 'blocked');
  assert.ok(/never inline/.test(job.blockedAtLoad || ''));
});

test('chain_from targeting a nonexistent job is BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-chained.md', { isolation: 'chained', chain_from: 'does-not-exist' });
  const jobs = loadQueue(dir);
  const job = jobs[0]!;
  assert.strictEqual(job.status, 'blocked');
  assert.ok(/not found/.test(job.blockedAtLoad || ''));
});

test('two jobs naming the same chain_from target are both ambiguously BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-root.md', { isolation: 'worktree' });
  writeJob(dir, '02-a.md', { isolation: 'chained', chain_from: '01-root' });
  writeJob(dir, '03-b.md', { isolation: 'chained', chain_from: '01-root' });
  const jobs = loadQueue(dir);
  const a = jobs.find((j) => j.identity === '02-a')!;
  const b = jobs.find((j) => j.identity === '03-b')!;
  assert.strictEqual(a.status, 'blocked');
  assert.strictEqual(b.status, 'blocked');
  assert.ok(/ambiguous/.test(a.blockedAtLoad || ''));
});

test('chain_from targeting a later job in queue order is BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-chained.md', { isolation: 'chained', chain_from: '02-root' });
  writeJob(dir, '02-root.md', { isolation: 'worktree' });
  const jobs = loadQueue(dir);
  const job = jobs.find((j) => j.identity === '01-chained')!;
  assert.strictEqual(job.status, 'blocked');
  assert.ok(/precede/.test(job.blockedAtLoad || ''));
});

test('a validation-blocked job status is persisted back to disk', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-chained.md', { isolation: 'chained', chain_from: 'missing' });
  loadQueue(dir);
  const { frontmatter } = readJobFile(path.join(dir, '.overnight-runner', 'jobs', '01-chained.md'));
  assert.strictEqual(frontmatter.status, 'blocked');
});

// --- serve state / snapshot ---

test('getSnapshot reports the target repo\'s folder name and live current branch', () => {
  const dir = tmpRepo();
  // A concrete, known branch name -- not one re-derived via the function
  // under test -- so a broken currentBranch() can't pass by construction.
  execFileSync('git', ['-C', dir, 'checkout', '-q', '-B', 'feature/preview']);
  const state = new ServeState(dir);
  const snapshot = state.getSnapshot();
  assert.strictEqual(snapshot.repo.name, path.basename(dir));
  assert.strictEqual(snapshot.repo.branch, 'feature/preview');
});

// --- migrate ---

function captureConsole(fn: () => void): { logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (msg?: unknown) => { logs.push(String(msg)); };
  console.error = (msg?: unknown) => { errors.push(String(msg)); };
  try {
    fn();
    return { logs, errors };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

test('migrate moves a pre-existing flat layout into .overnight-runner/ and prints a notice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-migrate-'));
  fs.mkdirSync(path.join(dir, 'jobs'));
  fs.writeFileSync(path.join(dir, 'jobs', '01-a.md'), 'a\n');
  fs.mkdirSync(path.join(dir, 'runs'));
  fs.writeFileSync(path.join(dir, 'runs', '2026-01-01-0000.md'), 'run\n');
  fs.writeFileSync(path.join(dir, '.overnight-runner-settings.json'), '{}\n');

  const { logs } = captureConsole(() => migrate(dir));

  assert.strictEqual(fs.readFileSync(path.join(dir, '.overnight-runner', 'jobs', '01-a.md'), 'utf8'), 'a\n');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.overnight-runner', 'runs', '2026-01-01-0000.md'), 'utf8'), 'run\n');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.overnight-runner', 'settings.json'), 'utf8'), '{}\n');
  assert.ok(!fs.existsSync(path.join(dir, 'jobs')));
  assert.ok(!fs.existsSync(path.join(dir, 'runs')));
  assert.ok(!fs.existsSync(path.join(dir, '.overnight-runner-settings.json')));
  assert.strictEqual(fs.readFileSync(path.join(dir, '.overnight-runner', '.gitignore'), 'utf8'), '*\n');
  assert.ok(logs.some((l) => l.includes('Migrated jobs, runs, .overnight-runner-settings.json into .overnight-runner/')));
});

test('migrate only creates the self-ignoring folder when there is nothing to migrate', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-migrate-'));
  const { logs } = captureConsole(() => migrate(dir));
  assert.strictEqual(fs.readFileSync(path.join(dir, '.overnight-runner', '.gitignore'), 'utf8'), '*\n');
  assert.strictEqual(logs.length, 0);
});

test('migrate leaves a conflicting old path in place and warns instead of clobbering', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-migrate-'));
  fs.mkdirSync(path.join(dir, 'jobs'));
  fs.writeFileSync(path.join(dir, 'jobs', 'old.md'), 'old\n');
  fs.mkdirSync(path.join(dir, '.overnight-runner', 'jobs'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.overnight-runner', 'jobs', 'new.md'), 'new\n');

  const { logs, errors } = captureConsole(() => migrate(dir));

  assert.strictEqual(fs.readFileSync(path.join(dir, 'jobs', 'old.md'), 'utf8'), 'old\n');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.overnight-runner', 'jobs', 'new.md'), 'utf8'), 'new\n');
  assert.ok(errors.some((e) => e.includes('both "jobs" and ".overnight-runner/jobs" exist')));
  assert.strictEqual(logs.length, 0);
});

// --- provider adapter ---

test('parseResult picks the last OVERNIGHT_RESULT line and its REASON', () => {
  const stdout = 'some noise\nOVERNIGHT_RESULT: PASS\nmore noise later\nOVERNIGHT_RESULT: BLOCKED\nREASON: tests still failing\n';
  const { result, reason } = parseResult(stdout, 1);
  assert.strictEqual(result, 'BLOCKED');
  assert.strictEqual(reason, 'tests still failing');
});

test('parseResult synthesizes BLOCKED when no result line is present', () => {
  const { result, reason } = parseResult('nothing useful here\n', 1);
  assert.strictEqual(result, 'BLOCKED');
  assert.ok(/no OVERNIGHT_RESULT emitted/.test(reason));
});

test('parseResult overrides a PASS-shaped line on non-zero exit', () => {
  const { result, reason } = parseResult('OVERNIGHT_RESULT: PASS\n', 1);
  assert.strictEqual(result, 'BLOCKED');
  assert.ok(/overriding emitted result/.test(reason));
});

test('buildPrompt uses $ for codex and / for claude/copilot', () => {
  assert.strictEqual(buildPrompt('codex', '/abs/jobs/x.md'), '$implement-overnight /abs/jobs/x.md');
  assert.strictEqual(buildPrompt('claude', '/abs/jobs/x.md'), '/implement-overnight /abs/jobs/x.md');
  assert.strictEqual(buildPrompt('copilot', '/abs/jobs/x.md'), '/implement-overnight /abs/jobs/x.md');
});

// --- run summary ---

test('run summary renders totals and per-job rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-summary-'));
  const summaryPath = path.join(dir, 'run.md');
  const jobs = [
    { identity: 'a', isolation: 'inline', initialStatus: 'pending', outcome: 'PASS' as const, duration: 65000, providerUsed: 'claude', commitRef: 'abc123', notes: '' },
    { identity: 'b', isolation: 'worktree', initialStatus: 'pending', outcome: 'BLOCKED' as const, duration: 5000, providerUsed: 'claude', branchProduced: 'overnight/b', commitRef: 'def456', notes: 'a | pipe' },
    { identity: 'c', isolation: 'inline', initialStatus: 'done' },
    { identity: 'd', isolation: 'inline', initialStatus: 'pending' },
  ];
  runSummary.write(summaryPath, { runStatus: 'complete', started: '2026-08-16T22:00:00.000Z', baseBranch: 'main', provider: 'claude', jobs });
  const content = fs.readFileSync(summaryPath, 'utf8');
  assert.ok(content.includes('run_status: complete'));
  assert.ok(content.includes('1 done, 1 blocked, 0 running, 1 skipped, 1 not run'));
  assert.ok(content.includes('| a | PASS | 1m05s | inline |'));
  assert.ok(content.includes('a \\| pipe'));
  assert.ok(content.includes('| c | SKIPPED |'));
  assert.ok(content.includes('| d | NOT RUN |'));
});

test('outcomeFor reports RUNNING for a job the runner marked as currently executing', () => {
  const job = { identity: 'e', isolation: 'inline', initialStatus: 'pending', outcome: 'RUNNING' as const };
  assert.strictEqual(runSummary.outcomeFor(job), 'RUNNING');
});

test('run summary renders a RUNNING row with a static duration cell and counts it in totals', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-summary-running-'));
  const summaryPath = path.join(dir, 'run.md');
  const jobs = [{ identity: 'e', isolation: 'worktree', initialStatus: 'pending', outcome: 'RUNNING' as const, duration: undefined }];
  runSummary.write(summaryPath, { runStatus: 'in-progress', started: '2026-08-16T22:00:00.000Z', baseBranch: 'main', provider: 'claude', jobs });
  const content = fs.readFileSync(summaryPath, 'utf8');
  assert.ok(content.includes('0 done, 0 blocked, 1 running, 0 skipped, 0 not run'));
  assert.ok(content.includes('| e | RUNNING | running | worktree |'));
});

test('run summary round-trips the ended timestamp through history parsing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-summary-ended-'));
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  const jobs = [{ identity: 'a', isolation: 'inline', initialStatus: 'pending', outcome: 'PASS' as const, duration: 1000 }];
  runSummary.write(path.join(dir, 'runs', '2026-08-16-2200.md'), {
    runStatus: 'complete',
    started: '2026-08-16T22:00:00.000Z',
    ended: '2026-08-16T22:10:00.000Z',
    baseBranch: 'main',
    provider: 'claude',
    jobs,
  });
  const detail = runHistory.readRun(dir, '2026-08-16-2200');
  assert.strictEqual(detail?.started, '2026-08-16T22:00:00.000Z');
  assert.strictEqual(detail?.ended, '2026-08-16T22:10:00.000Z');
});

test('an in-progress run summary round-trips an empty ended field', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-summary-inprogress-'));
  fs.mkdirSync(path.join(dir, 'runs'), { recursive: true });
  runSummary.write(path.join(dir, 'runs', '2026-08-16-2201.md'), {
    runStatus: 'in-progress',
    started: '2026-08-16T22:00:00.000Z',
    baseBranch: 'main',
    provider: 'claude',
    jobs: [],
  });
  const detail = runHistory.readRun(dir, '2026-08-16-2201');
  assert.strictEqual(detail?.ended, '');
});

// --- progress lines ---

test('formatKickoff summarizes queue counts and base branch', () => {
  const jobs = [{ status: 'done' }, { status: 'blocked' }, { status: 'pending' }, { status: 'pending' }];
  const line = progress.formatKickoff('2026-08-16-2200', jobs, 'main');
  assert.strictEqual(line, 'Run 2026-08-16-2200: 4 jobs (2 pending, 1 done, 1 blocked) — base branch main');
});

test('formatKickoff singularizes "job" for a one-job queue', () => {
  const line = progress.formatKickoff('2026-08-16-2200', [{ status: 'pending' }], 'main');
  assert.strictEqual(line, 'Run 2026-08-16-2200: 1 job (1 pending, 0 done, 0 blocked) — base branch main');
});

test('formatKickoff tallies by post-validation status, not the original frontmatter status', () => {
  // A job that fails chain_from validation this run has its frontmatter status
  // (pending) mutated to "blocked" at queue-load, before the kickoff line ever
  // prints -- the tally must agree with the "BLOCKED at queue load" line that
  // immediately follows it, not the status the job started with in its file.
  const jobs = [{ status: 'pending' }, { status: 'blocked' }];
  const line = progress.formatKickoff('2026-08-16-2200', jobs, 'main');
  assert.strictEqual(line, 'Run 2026-08-16-2200: 2 jobs (1 pending, 0 done, 1 blocked) — base branch main');
});

test('formatSkip reports "already <status>" for a job skipped from an earlier run', () => {
  const line = progress.formatSkip({ identity: '01-a', initialStatus: 'done', blockedAtLoad: null }, { position: 3, total: 5 });
  assert.strictEqual(line, '[3/5] 01-a SKIPPED (already done)');
});

test('formatSkip reports BLOCKED-at-load for a job that failed chain_from validation this run', () => {
  const line = progress.formatSkip({ identity: '02-b', initialStatus: 'pending', blockedAtLoad: 'chain_from target "x" not found in queue' }, { position: 2, total: 5 });
  assert.strictEqual(line, '[2/5] 02-b BLOCKED at queue load: chain_from target "x" not found in queue');
});

test('formatStarted names position, isolation mode, and provider', () => {
  const line = progress.formatStarted({ identity: '04-x', isolation: 'worktree' }, { position: 4, total: 5 }, 'claude');
  assert.strictEqual(line, '[4/5] 04-x started (worktree, claude)');
});

test('formatStarted falls back to "default" when no provider is known', () => {
  const line = progress.formatStarted({ identity: '04-x', isolation: 'inline' }, { position: 4, total: 5 }, undefined);
  assert.strictEqual(line, '[4/5] 04-x started (inline, default)');
});

test('formatHeartbeat reports elapsed and remaining time', () => {
  const line = progress.formatHeartbeat({ identity: '04-x' }, { position: 4, total: 5 }, 15 * 60 * 1000, 60 * 60 * 1000);
  assert.strictEqual(line, '[4/5] 04-x still running... 15m00s elapsed (timeout in 45m00s)');
});

test('formatHeartbeat never reports negative remaining time once elapsed passes the timeout', () => {
  const line = progress.formatHeartbeat({ identity: '04-x' }, { position: 4, total: 5 }, 65 * 60 * 1000, 60 * 60 * 1000);
  assert.strictEqual(line, '[4/5] 04-x still running... 65m00s elapsed (timeout in 0m00s)');
});

test('formatFinished reports outcome and duration with no suffix for a non-inline BLOCKED', () => {
  const line = progress.formatFinished({ identity: '03-x', outcome: 'BLOCKED', duration: 220000 }, { position: 3, total: 5 }, false);
  assert.strictEqual(line, '[3/5] 03-x BLOCKED in 3m40s');
});

test('formatFinished appends the stopping-run suffix only when the run is halting', () => {
  const line = progress.formatFinished({ identity: '04-x', outcome: 'BLOCKED', duration: 220000 }, { position: 4, total: 5 }, true);
  assert.strictEqual(line, '[4/5] 04-x BLOCKED in 3m40s — stopping run (inline BLOCKED halts the queue)');
});

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
