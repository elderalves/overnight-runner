'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { readJobFile, writeStatus, identityFor } = require('../lib/frontmatter');
const { loadQueue } = require('../lib/queue');
const { parseResult, buildPrompt } = require('../lib/providers');
const runSummary = require('../lib/runSummary');

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${name}`);
    console.error(err.stack || err.message);
  }
}

function tmpRepo() {
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

function writeJob(dir, file, frontmatter, body = 'Do the thing.\n') {
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
  const chained = jobs.find((j) => j.identity === '02-next');
  assert.strictEqual(chained.resolvedBranch, 'overnight/01-root');
  assert.strictEqual(chained.blockedAtLoad, null);
});

test('multi-hop chain resolves to the original root, not the intermediate', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-root.md', { isolation: 'worktree' });
  writeJob(dir, '02-mid.md', { isolation: 'chained', chain_from: '01-root' });
  writeJob(dir, '03-leaf.md', { isolation: 'chained', chain_from: '02-mid' });
  const jobs = loadQueue(dir);
  const leaf = jobs.find((j) => j.identity === '03-leaf');
  assert.strictEqual(leaf.resolvedBranch, 'overnight/01-root');
});

test('chain_from targeting an inline job is BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-inline.md', {});
  writeJob(dir, '02-chained.md', { isolation: 'chained', chain_from: '01-inline' });
  const jobs = loadQueue(dir);
  const job = jobs.find((j) => j.identity === '02-chained');
  assert.strictEqual(job.status, 'blocked');
  assert.ok(/never inline/.test(job.blockedAtLoad));
});

test('chain_from targeting a nonexistent job is BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-chained.md', { isolation: 'chained', chain_from: 'does-not-exist' });
  const jobs = loadQueue(dir);
  const job = jobs[0];
  assert.strictEqual(job.status, 'blocked');
  assert.ok(/not found/.test(job.blockedAtLoad));
});

test('two jobs naming the same chain_from target are both ambiguously BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-root.md', { isolation: 'worktree' });
  writeJob(dir, '02-a.md', { isolation: 'chained', chain_from: '01-root' });
  writeJob(dir, '03-b.md', { isolation: 'chained', chain_from: '01-root' });
  const jobs = loadQueue(dir);
  const a = jobs.find((j) => j.identity === '02-a');
  const b = jobs.find((j) => j.identity === '03-b');
  assert.strictEqual(a.status, 'blocked');
  assert.strictEqual(b.status, 'blocked');
  assert.ok(/ambiguous/.test(a.blockedAtLoad));
});

test('chain_from targeting a later job in queue order is BLOCKED', () => {
  const dir = tmpRepo();
  writeJob(dir, '01-chained.md', { isolation: 'chained', chain_from: '02-root' });
  writeJob(dir, '02-root.md', { isolation: 'worktree' });
  const jobs = loadQueue(dir);
  const job = jobs.find((j) => j.identity === '01-chained');
  assert.strictEqual(job.status, 'blocked');
  assert.ok(/precede/.test(job.blockedAtLoad));
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

// --- run summary ---

test('run summary renders totals and per-job rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'overnight-runner-summary-'));
  const summaryPath = path.join(dir, 'run.md');
  const jobs = [
    { identity: 'a', isolation: 'inline', initialStatus: 'pending', outcome: 'PASS', duration: 65000, providerUsed: 'claude', commitRef: 'abc123', notes: '' },
    { identity: 'b', isolation: 'worktree', initialStatus: 'pending', outcome: 'BLOCKED', duration: 5000, providerUsed: 'claude', branchProduced: 'overnight/b', commitRef: 'def456', notes: 'a | pipe' },
    { identity: 'c', isolation: 'inline', initialStatus: 'done' },
    { identity: 'd', isolation: 'inline', initialStatus: 'pending' },
  ];
  runSummary.write(summaryPath, { runStatus: 'complete', started: '2026-08-16T22:00:00.000Z', baseBranch: 'main', provider: 'claude', jobs });
  const content = fs.readFileSync(summaryPath, 'utf8');
  assert.ok(content.includes('run_status: complete'));
  assert.ok(content.includes('1 done, 1 blocked, 1 skipped, 1 not run'));
  assert.ok(content.includes('| a | PASS | 1m05s | inline |'));
  assert.ok(content.includes('a \\| pipe'));
  assert.ok(content.includes('| c | SKIPPED |'));
  assert.ok(content.includes('| d | NOT RUN |'));
});

if (failures > 0) {
  console.error(`\n${failures} smoke test(s) failed.`);
  process.exit(1);
}
console.log('\nAll smoke tests passed.');
