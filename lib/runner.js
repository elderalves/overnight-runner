'use strict';

const path = require('path');
const git = require('./git');
const { loadQueue } = require('./queue');
const { writeStatus } = require('./frontmatter');
const providers = require('./providers');
const isolation = require('./isolation');
const runSummary = require('./runSummary');

function runId(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function safeShortRef(repoPath, ref) {
  try {
    return git.shortRef(repoPath, ref);
  } catch {
    return '';
  }
}

async function run(repoPath, { defaultProvider, timeoutMs } = {}) {
  const baseBranch = git.currentBranch(repoPath);
  const started = new Date();
  const id = runId(started);
  const summaryPath = path.join(repoPath, 'runs', `${id}.md`);
  const logsDir = path.join(repoPath, 'runs', id, 'logs');

  const jobs = loadQueue(repoPath);

  const state = {
    runStatus: 'in-progress',
    started: started.toISOString(),
    baseBranch,
    provider: defaultProvider,
    jobs,
  };
  runSummary.write(summaryPath, state);

  for (const job of jobs) {
    // Already done/blocked from an earlier run (SKIPPED), or blocked at
    // queue-load this run (chain_from validation) -- neither executes.
    if (job.initialStatus === 'done' || job.initialStatus === 'blocked' || job.blockedAtLoad) {
      continue;
    }

    const stop = await executeJob(repoPath, baseBranch, job, defaultProvider, timeoutMs, logsDir);
    runSummary.write(summaryPath, state);
    if (stop) break; // inline BLOCKED stops the run; remaining jobs report NOT RUN
  }

  state.runStatus = 'complete';
  runSummary.write(summaryPath, state);
  return summaryPath;
}

// Runs one job to completion, mutating it in place with outcome/duration/etc.
// Returns true if the run should stop early (an inline job came back BLOCKED).
async function executeJob(repoPath, baseBranch, job, defaultProvider, timeoutMs, logsDir) {
  const effectiveProvider = job.provider || defaultProvider;
  job.providerUsed = effectiveProvider;

  let setupResult;
  try {
    setupResult = isolation.setup(repoPath, job, baseBranch);
  } catch (err) {
    setupResult = { blocked: `unexpected error during isolation setup: ${err.message}` };
  }

  if (setupResult.blocked) {
    job.outcome = 'BLOCKED';
    job.notes = setupResult.blocked;
    job.status = 'blocked';
    writeStatus(job.filePath, 'blocked');
    return job.isolation === 'inline';
  }

  try {
    const prompt = providers.buildPrompt(effectiveProvider, job.filePath);
    const logPath = path.join(logsDir, `${job.identity}.log`);

    const startTime = Date.now();
    const result = await providers.runProvider(effectiveProvider, prompt, setupResult.cwd, { timeoutMs, logPath });
    job.duration = Date.now() - startTime;

    isolation.teardown(repoPath, setupResult);

    job.outcome = result.result;
    job.notes = result.reason || '';
    job.branchProduced = setupResult.branchProduced;
    job.commitRef = safeShortRef(repoPath, job.branchProduced || 'HEAD');

    return job.isolation === 'inline' && job.outcome === 'BLOCKED';
  } catch (err) {
    // Only reachable when the provider process itself never started (e.g. an
    // unknown provider name) -- the skill never ran, so nothing else will ever
    // write this job's status; the runner must, same as the isolation-blocked case.
    isolation.teardown(repoPath, setupResult);
    job.outcome = 'BLOCKED';
    job.notes = `unexpected runner error: ${err.message}`;
    job.status = 'blocked';
    writeStatus(job.filePath, 'blocked');
    return job.isolation === 'inline';
  }
}

module.exports = { run };
