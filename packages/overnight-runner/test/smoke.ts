import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { readJobFile, writeStatus, identityFor } from '../lib/frontmatter.ts';
import { loadQueue } from '../lib/queue.ts';
import { parseResult, buildPrompt, matchSentinelLine, LineBuffer, ActivityTracker, detectActivity } from '../lib/providers.ts';
import * as runSummary from '../lib/runSummary.ts';
import * as runHistory from '../lib/runHistory.ts';
import * as progress from '../lib/progress.ts';
import { migrate } from '../lib/migrate.ts';
import { ServeState } from '../server/runState.ts';
import * as gitInfo from '../server/git/info.ts';
import * as gitChanges from '../server/git/changes.ts';
import * as gitBranch from '../server/git/branch.ts';
import { isSafeGitRef } from '../server/git/refs.ts';
import { createApp } from '../server/app.ts';
import * as runner from '../lib/runner.ts';

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

// Async counterpart to test() -- registers rather than runs, so every case
// stays declared next to its sync siblings in file order; runAsyncTests()
// (called once, at the bottom of the file) awaits them in that same order.
const asyncTests: { name: string; fn: () => Promise<void> }[] = [];

function testAsync(name: string, fn: () => Promise<void>): void {
  asyncTests.push({ name, fn });
}

async function runAsyncTests(): Promise<void> {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (err) {
      failures++;
      console.error(`FAIL - ${name}`);
      console.error((err as Error).stack || (err as Error).message);
    }
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

function headRef(dir: string): string {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

// Writes, stages, and commits one file -- returns the new commit's full sha.
function commitFile(dir: string, file: string, content: string, message: string): string {
  fs.writeFileSync(path.join(dir, file), content);
  execFileSync('git', ['-C', dir, 'add', file]);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', message]);
  return headRef(dir);
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

// --- live progress sentinels ---

test('matchSentinelLine recognizes OVERNIGHT_PHASE and OVERNIGHT_NOTE', () => {
  assert.deepStrictEqual(matchSentinelLine('OVERNIGHT_PHASE: implement'), { type: 'phase', value: 'implement' });
  assert.deepStrictEqual(matchSentinelLine('OVERNIGHT_NOTE: starting handoff step 2/4'), {
    type: 'note',
    value: 'starting handoff step 2/4',
  });
});

test('matchSentinelLine ignores unrelated lines', () => {
  assert.strictEqual(matchSentinelLine('just some prose'), null);
  assert.strictEqual(matchSentinelLine('OVERNIGHT_RESULT: PASS'), null);
});

test('matchSentinelLine trims trailing whitespace from the value', () => {
  assert.deepStrictEqual(matchSentinelLine('OVERNIGHT_PHASE:   test   '), { type: 'phase', value: 'test' });
});

test('LineBuffer reassembles lines split across chunk boundaries', () => {
  const buf = new LineBuffer();
  assert.deepStrictEqual(buf.push('OVERNIGHT_PHA'), []);
  assert.deepStrictEqual(buf.push('SE: implement\nOVERNIGHT_NOTE: sta'), ['OVERNIGHT_PHASE: implement']);
  assert.deepStrictEqual(buf.push('rting\n'), ['OVERNIGHT_NOTE: starting']);
});

test('LineBuffer emits multiple complete lines from one chunk', () => {
  const buf = new LineBuffer();
  assert.deepStrictEqual(buf.push('a\nb\nc\n'), ['a', 'b', 'c']);
});

test('LineBuffer.flush recovers a final line with no trailing newline', () => {
  const buf = new LineBuffer();
  assert.deepStrictEqual(buf.push('OVERNIGHT_PHASE: finalize'), []);
  assert.deepStrictEqual(buf.flush(), ['OVERNIGHT_PHASE: finalize']);
});

test('LineBuffer.flush is a no-op once already newline-terminated', () => {
  const buf = new LineBuffer();
  buf.push('a\n');
  assert.deepStrictEqual(buf.flush(), []);
});

test('ActivityTracker reports the first sighting of an activity', () => {
  const tracker = new ActivityTracker();
  assert.deepStrictEqual(tracker.report({ file: 'a.ts', changedCount: 1 }), { file: 'a.ts', changedCount: 1 });
});

test('ActivityTracker suppresses a repeat of the same file and count', () => {
  const tracker = new ActivityTracker();
  tracker.report({ file: 'a.ts', changedCount: 1 });
  assert.strictEqual(tracker.report({ file: 'a.ts', changedCount: 1 }), null);
});

test('ActivityTracker re-reports once the file or count changes', () => {
  const tracker = new ActivityTracker();
  tracker.report({ file: 'a.ts', changedCount: 1 });
  assert.deepStrictEqual(tracker.report({ file: 'a.ts', changedCount: 2 }), { file: 'a.ts', changedCount: 2 });
  assert.deepStrictEqual(tracker.report({ file: 'b.ts', changedCount: 2 }), { file: 'b.ts', changedCount: 2 });
});

test('ActivityTracker passes null through for a clean tree', () => {
  const tracker = new ActivityTracker();
  assert.strictEqual(tracker.report(null), null);
});

test('detectActivity reports the changed file and count on a dirty worktree', () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, '.overnight-runner', 'jobs', 'scratch.md'), 'x');
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\nedited\n');
  const info = detectActivity(dir);
  assert.ok(info);
  assert.strictEqual(info!.changedCount, 2);
});

test('detectActivity returns null on a clean worktree', () => {
  const dir = tmpRepo();
  assert.strictEqual(detectActivity(dir), null);
});

test('detectActivity returns null when cwd is not a git repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-not-a-repo-'));
  assert.strictEqual(detectActivity(dir), null);
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
  fs.mkdirSync(path.join(dir, '.overnight-runner', 'runs'), { recursive: true });
  const jobs = [{ identity: 'a', isolation: 'inline', initialStatus: 'pending', outcome: 'PASS' as const, duration: 1000 }];
  runSummary.write(path.join(dir, '.overnight-runner', 'runs', '2026-08-16-2200.md'), {
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
  fs.mkdirSync(path.join(dir, '.overnight-runner', 'runs'), { recursive: true });
  runSummary.write(path.join(dir, '.overnight-runner', 'runs', '2026-08-16-2201.md'), {
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

test('formatPhase names position and the self-reported phase token', () => {
  const line = progress.formatPhase({ identity: '01-x' }, { position: 1, total: 2 }, 'review');
  assert.strictEqual(line, '[1/2] 01-x phase: review');
});

test('formatNote forwards the skill-authored note text verbatim', () => {
  const line = progress.formatNote({ identity: '01-x' }, { position: 1, total: 2 }, 'starting handoff step 2/4');
  assert.strictEqual(line, '[1/2] 01-x — starting handoff step 2/4');
});

test('formatActivity reports the touched file with no suffix for a single change', () => {
  const line = progress.formatActivity({ identity: '01-x' }, { position: 1, total: 2 }, { file: 'src/foo.ts', changedCount: 1 });
  assert.strictEqual(line, '[1/2] 01-x touched src/foo.ts');
});

test('formatActivity appends a "+N more" suffix when other files also changed', () => {
  const line = progress.formatActivity({ identity: '01-x' }, { position: 1, total: 2 }, { file: 'src/foo.ts', changedCount: 3 });
  assert.strictEqual(line, '[1/2] 01-x touched src/foo.ts (+2 more)');
});

// --- git refs (dash guard) ---

test('isSafeGitRef rejects empty and option-like refs', () => {
  assert.strictEqual(isSafeGitRef(''), false);
  assert.strictEqual(isSafeGitRef('-x'), false);
  assert.strictEqual(isSafeGitRef('--upload-pack=x'), false);
  assert.strictEqual(isSafeGitRef('main'), true);
});

// --- git/info.ts ---

testAsync('getRepoInfo reports root and branch, and no remote for a local-only repo', async () => {
  const dir = tmpRepo();
  const info = await gitInfo.getRepoInfo(dir);
  assert.ok(info);
  assert.strictEqual(fs.realpathSync(info!.root), fs.realpathSync(dir));
  assert.strictEqual(info!.remote, undefined);
});

testAsync('getRepoInfo returns null outside a git repository', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-notgit-'));
  const info = await gitInfo.getRepoInfo(dir);
  assert.strictEqual(info, null);
});

testAsync('getStatus reports untracked and modified files', async () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\nchanged\n');
  fs.writeFileSync(path.join(dir, 'new.txt'), 'new file\n');
  const status = await gitInfo.getStatus(dir);
  const byPath = new Map(status.map((s) => [s.path, s.status]));
  assert.strictEqual(byPath.get('README.md'), 'M');
  assert.strictEqual(byPath.get('new.txt'), '??');
});

testAsync('getBranches lists local branches and filters out overnight/ worktree job branches', async () => {
  const dir = tmpRepo();
  execFileSync('git', ['-C', dir, 'branch', 'feature/x']);
  execFileSync('git', ['-C', dir, 'branch', 'overnight/01-a']);
  const branches = await gitInfo.getBranches(dir);
  assert.ok(branches.includes('feature/x'));
  assert.ok(!branches.some((b) => b.startsWith('overnight/')));
});

testAsync('getLog returns entries newest-first, capped by count', async () => {
  const dir = tmpRepo();
  commitFile(dir, 'a.txt', 'a\n', 'add a');
  commitFile(dir, 'b.txt', 'b\n', 'add b');
  const log = await gitInfo.getLog(dir, 2);
  assert.strictEqual(log.length, 2);
  assert.strictEqual(log[0]!.subject, 'add b');
  assert.strictEqual(log[1]!.subject, 'add a');
});

// --- git/changes.ts: pure parsing helpers ---

test('parseNumstatZ parses added, modified, and rename entries', () => {
  const out = ['1\t0\tnew.txt', '2\t3\tmod.txt', '0\t0\t', 'old.txt', 'new-name.txt'].join('\0');
  const entries = gitChanges.parseNumstatZ(out);
  assert.deepStrictEqual(entries, [
    { adds: 1, dels: 0, binary: false, path: 'new.txt' },
    { adds: 2, dels: 3, binary: false, path: 'mod.txt' },
    { adds: 0, dels: 0, binary: false, oldPath: 'old.txt', path: 'new-name.txt' },
  ]);
});

test('parseNameStatusZ parses status codes and rename pairs', () => {
  const out = ['A', 'new.txt', 'M', 'mod.txt', 'R100', 'old.txt', 'new-name.txt'].join('\0');
  const entries = gitChanges.parseNameStatusZ(out);
  assert.deepStrictEqual(entries, [
    { status: 'A', path: 'new.txt' },
    { status: 'M', path: 'mod.txt' },
    { status: 'R100', oldPath: 'old.txt', path: 'new-name.txt' },
  ]);
});

const TWO_FILE_PATCH = [
  'diff --git a/one.txt b/one.txt',
  'index 111..222 100644',
  '--- a/one.txt',
  '+++ b/one.txt',
  '@@ -1 +1 @@',
  '-old',
  '+new',
  'diff --git a/two.txt b/two.txt',
  'index 333..444 100644',
  '--- a/two.txt',
  '+++ b/two.txt',
  '@@ -1 +1 @@',
  '-a',
  '+b',
  '',
].join('\n');

test('splitPatch splits a multi-file patch blob into per-file sections in order', () => {
  const sections = gitChanges.splitPatch(TWO_FILE_PATCH);
  assert.strictEqual(sections.length, 2);
  assert.ok(sections[0]!.startsWith('diff --git a/one.txt'));
  assert.ok(sections[1]!.startsWith('diff --git a/two.txt'));
});

test('patchByPath maps each section to its new-side path', () => {
  const sections = gitChanges.splitPatch(TWO_FILE_PATCH);
  const map = gitChanges.patchByPath(sections);
  assert.strictEqual(map.size, 2);
  assert.ok(map.get('one.txt')!.includes('-old'));
  assert.ok(map.get('two.txt')!.includes('-a'));
});

// --- git/changes.ts: collectors ---

testAsync('collectWorkingTreeChanges surfaces untracked files without mutating the real index', async () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'untracked.txt'), 'hello\n');
  const before = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' });
  const result = await gitChanges.collectWorkingTreeChanges(dir);
  assert.ok(result.ok);
  if (result.ok) {
    const file = result.changes.files.find((f) => f.path === 'untracked.txt');
    assert.ok(file, 'untracked file should appear in the working-tree diff');
    assert.strictEqual(file!.status, 'added');
  }
  const after = execFileSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' });
  assert.strictEqual(before, after, 'a read-only GET must never mutate the real index');
});

testAsync('collectRangeChanges diffs exactly startRef..endRef, not merge-base or last-commit-only', async () => {
  const dir = tmpRepo();
  const startRef = headRef(dir);
  commitFile(dir, 'a.txt', 'a\n', 'add a');
  const endRef = commitFile(dir, 'b.txt', 'b\n', 'add b');
  commitFile(dir, 'c.txt', 'c\n', 'add c (after the captured range)');

  const result = await gitChanges.collectRangeChanges(dir, startRef, endRef);
  assert.ok(result.ok);
  if (result.ok) {
    const paths = result.changes.files.map((f) => f.path).sort();
    assert.deepStrictEqual(paths, ['a.txt', 'b.txt']);
  }
});

testAsync('collectRangeChanges rejects an option-like ref', async () => {
  const dir = tmpRepo();
  const result = await gitChanges.collectRangeChanges(dir, '--upload-pack=evil', 'HEAD');
  assert.strictEqual(result.ok, false);
});

testAsync('collectCommitChanges returns a structured single-commit diff', async () => {
  const dir = tmpRepo();
  const sha = commitFile(dir, 'a.txt', 'a\n', 'add a');
  const result = await gitChanges.collectCommitChanges(dir, sha);
  assert.ok(result.ok);
  if (result.ok) {
    assert.strictEqual(result.commit.subject, 'add a');
    assert.strictEqual(result.commit.files.length, 1);
    assert.strictEqual(result.commit.files[0]!.path, 'a.txt');
  }
});

testAsync('collectCommitChanges reports an unknown sha as a 409-shaped error, not a throw', async () => {
  const dir = tmpRepo();
  const result = await gitChanges.collectCommitChanges(dir, 'deadbeef');
  assert.strictEqual(result.ok, false);
});

testAsync('collectCommitChanges truncates a patch past the configured cap', async () => {
  const dir = tmpRepo();
  const sha = commitFile(dir, 'big.txt', `${'x'.repeat(500)}\n`, 'add big file');
  const result = await gitChanges.collectCommitChanges(dir, sha, 50);
  assert.ok(result.ok);
  if (result.ok) {
    const file = result.commit.files[0]!;
    assert.ok(file.patch.endsWith('… (patch truncated)'));
    assert.ok(file.patch.length < 500);
  }
});

testAsync('collectRangeCommits returns commits inside the range, newest first', async () => {
  const dir = tmpRepo();
  const startRef = headRef(dir);
  commitFile(dir, 'a.txt', 'a\n', 'add a');
  const endRef = commitFile(dir, 'b.txt', 'b\n', 'add b');
  commitFile(dir, 'c.txt', 'c\n', 'add c (after the captured range)');

  const result = await gitChanges.collectRangeCommits(dir, startRef, endRef);
  assert.ok(result.ok);
  if (result.ok) assert.deepStrictEqual(result.commits.map((c) => c.subject), ['add b', 'add a']);
});

testAsync('collectRangeCommits reports empty, not an error, for a job that made no commits', async () => {
  const dir = tmpRepo();
  const ref = headRef(dir);
  const result = await gitChanges.collectRangeCommits(dir, ref, ref);
  assert.ok(result.ok);
  if (result.ok) assert.deepStrictEqual(result.commits, []);
});

// --- git/branch.ts ---

testAsync('createOrSwitchBranch creates and switches to a new branch from an explicit start point', async () => {
  const dir = tmpRepo();
  const start = headRef(dir);
  const result = await gitBranch.createOrSwitchBranch(dir, 'feature/new', start);
  assert.ok(result.ok);
  if (result.ok) {
    assert.strictEqual(result.branch, 'feature/new');
    assert.strictEqual(result.created, true);
  }
  assert.strictEqual(execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim(), 'feature/new');
});

testAsync('createOrSwitchBranch switches to an already-existing local branch', async () => {
  const dir = tmpRepo();
  execFileSync('git', ['-C', dir, 'branch', 'existing']);
  const result = await gitBranch.createOrSwitchBranch(dir, 'existing');
  assert.ok(result.ok);
  if (result.ok) assert.strictEqual(result.created, false);
});

testAsync('createOrSwitchBranch rejects an invalid branch name', async () => {
  const dir = tmpRepo();
  const result = await gitBranch.createOrSwitchBranch(dir, 'not a valid name');
  assert.strictEqual(result.ok, false);
});

testAsync('createOrSwitchBranch rejects an unknown start point', async () => {
  const dir = tmpRepo();
  const result = await gitBranch.createOrSwitchBranch(dir, 'feature/y', 'does-not-exist');
  assert.strictEqual(result.ok, false);
});

testAsync('createOrSwitchBranch reports a dirty-tree checkout conflict rather than throwing', async () => {
  const dir = tmpRepo();
  execFileSync('git', ['-C', dir, 'branch', 'other']);
  execFileSync('git', ['-C', dir, 'checkout', '-q', 'other']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# other content\n');
  execFileSync('git', ['-C', dir, 'add', '.']);
  execFileSync('git', ['-C', dir, 'commit', '-q', '-m', 'change on other']);
  execFileSync('git', ['-C', dir, 'checkout', '-q', '-']);
  fs.writeFileSync(path.join(dir, 'README.md'), '# conflicting uncommitted change\n');

  const result = await gitBranch.createOrSwitchBranch(dir, 'other');
  assert.strictEqual(result.ok, false);
});

// --- /api/git routes ---

testAsync('GET /api/git returns repo info, status, log, and branches, with baseBranch null by default', async () => {
  const dir = tmpRepo();
  const app = createApp(dir);
  const res = await app.request('/api/git');
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as any;
  assert.strictEqual(fs.realpathSync(body.info.root), fs.realpathSync(dir));
  assert.deepStrictEqual(body.status, []);
  assert.ok(Array.isArray(body.log));
  assert.ok(Array.isArray(body.branches));
  assert.strictEqual(body.baseBranch, null);
});

testAsync('GET /api/git reflects a persisted Configured base branch', async () => {
  const dir = tmpRepo();
  fs.writeFileSync(
    path.join(dir, '.overnight-runner-settings.json'),
    JSON.stringify({ defaultProvider: 'claude', defaultTimeoutMinutes: 60, defaultIsolation: 'inline', baseBranch: 'main' })
  );
  const app = createApp(dir);
  const res = await app.request('/api/git');
  const body = (await res.json()) as any;
  assert.strictEqual(body.baseBranch, 'main');
});

testAsync('GET /api/git/changes returns structured changes for an untracked file', async () => {
  const dir = tmpRepo();
  fs.writeFileSync(path.join(dir, 'new.txt'), 'hi\n');
  const app = createApp(dir);
  const res = await app.request('/api/git/changes');
  assert.strictEqual(res.status, 200);
  const body = (await res.json()) as any;
  assert.ok(body.files.some((f: { path: string }) => f.path === 'new.txt'));
});

testAsync('GET /api/git/commit/:sha returns 409 for an invalid sha', async () => {
  const dir = tmpRepo();
  const app = createApp(dir);
  const res = await app.request('/api/git/commit/not-a-sha');
  assert.strictEqual(res.status, 409);
  const body = (await res.json()) as any;
  assert.strictEqual(typeof body.error, 'string');
});

testAsync('POST /api/git/branch creates/switches on success and reports 409 for an invalid name', async () => {
  const dir = tmpRepo();
  const app = createApp(dir);
  const ok = await app.request('/api/git/branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'feature/via-api' }),
  });
  assert.strictEqual(ok.status, 200);
  const okBody = (await ok.json()) as any;
  assert.strictEqual(okBody.created, true);

  const bad = await app.request('/api/git/branch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'not a valid name' }),
  });
  assert.strictEqual(bad.status, 409);
});

// --- per-job Git routes (/api/runs/:runId/jobs/:identity/*) ---

testAsync('per-job Git routes serve jobStartRef..jobEndRef across worktree, chained, and inline isolation', async () => {
  const dir = tmpRepo();
  // The inline job's BLOCKED halts the queue (isolation-mode-mechanics.md), so
  // it runs LAST here -- worktree and chained must still get to execute (and
  // capture their own jobStartRef/jobEndRef) beforehand.
  writeJob(dir, '01-worktree.md', { isolation: 'worktree' });
  writeJob(dir, '02-chained.md', { isolation: 'chained', chain_from: '01-worktree' });
  writeJob(dir, '03-inline.md', {});

  // An unknown provider means the isolation setup (and so jobStartRef/jobEndRef
  // capture) still runs to completion; the provider process just never starts,
  // which the runner already treats as a normal BLOCKED outcome.
  const summaryPath = await runner.run(dir, { defaultProvider: 'nonexistent-provider-xyz', timeoutMs: 5000 });
  const runId = path.basename(summaryPath, '.md');
  const app = createApp(dir);

  const detail = (await (await app.request(`/api/runs/${runId}`)).json()) as any;
  const rowFor = (identity: string) => detail.jobs.find((j: any) => j.job === identity);

  for (const identity of ['01-worktree', '02-chained', '03-inline']) {
    const row = rowFor(identity);
    assert.ok(row?.jobStartRef, `${identity} should have a captured jobStartRef`);
    assert.ok(row?.jobEndRef, `${identity} should have a captured jobEndRef`);

    const res = await app.request(`/api/runs/${runId}/jobs/${identity}/changes`);
    assert.strictEqual(res.status, 200, `${identity} changes route should 200`);
    const commits = await app.request(`/api/runs/${runId}/jobs/${identity}/commits`);
    assert.strictEqual(commits.status, 200, `${identity} commits route should 200`);
  }

  const unknownJob = await app.request(`/api/runs/${runId}/jobs/does-not-exist/changes`);
  assert.strictEqual(unknownJob.status, 404);

  const unknownRun = await app.request('/api/runs/not-a-real-run/jobs/01-worktree/changes');
  assert.strictEqual(unknownRun.status, 404);
});

testAsync('per-job Git routes return an empty successful response when the job has no persisted diff range', async () => {
  const dir = tmpRepo();
  // A pre-existing branch collision blocks isolation setup before jobStartRef is ever captured.
  execFileSync('git', ['-C', dir, 'branch', 'overnight/01-collide']);
  writeJob(dir, '01-collide.md', { isolation: 'worktree' });

  const summaryPath = await runner.run(dir, { defaultProvider: 'nonexistent-provider-xyz', timeoutMs: 5000 });
  const runId = path.basename(summaryPath, '.md');
  const app = createApp(dir);

  const changes = await app.request(`/api/runs/${runId}/jobs/01-collide/changes`);
  assert.strictEqual(changes.status, 200);
  assert.deepStrictEqual(await changes.json(), { files: [], stat: { adds: 0, dels: 0, files: 0 } });

  const commits = await app.request(`/api/runs/${runId}/jobs/01-collide/commits`);
  assert.strictEqual(commits.status, 200);
  assert.deepStrictEqual(await commits.json(), { commits: [] });
});

await runAsyncTests();

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
