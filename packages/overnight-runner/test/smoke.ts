import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { readJobFile, writeStatus, identityFor } from '../lib/frontmatter.ts';
import { loadQueue } from '../lib/queue.ts';
import { parseResult, buildPrompt, matchSentinelLine, LineBuffer, ActivityTracker, detectActivity } from '../lib/providers.ts';
import * as runSummary from '../lib/runSummary.ts';
import * as progress from '../lib/progress.ts';

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
  fs.mkdirSync(path.join(dir, 'jobs'));
  return dir;
}

function writeJob(dir: string, file: string, frontmatter: Record<string, string>, body = 'Do the thing.\n'): void {
  const lines = ['---'];
  for (const [k, v] of Object.entries(frontmatter)) lines.push(`${k}: ${v}`);
  lines.push('---', '');
  fs.writeFileSync(path.join(dir, 'jobs', file), lines.join('\n') + body);
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
  const { frontmatter } = readJobFile(path.join(dir, 'jobs', '01-chained.md'));
  assert.strictEqual(frontmatter.status, 'blocked');
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
  fs.writeFileSync(path.join(dir, 'jobs', 'scratch.md'), 'x');
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

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
