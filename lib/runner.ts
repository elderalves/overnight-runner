import path from 'node:path';
import * as git from './git.ts';
import { loadQueue } from './queue.ts';
import type { Job } from './queue.ts';
import { writeStatus } from './frontmatter.ts';
import * as providers from './providers.ts';
import * as isolation from './isolation.ts';
import type { IsolationResult } from './isolation.ts';
import * as runSummary from './runSummary.ts';
import type { Run } from './runSummary.ts';

function runId(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function safeShortRef(repoPath: string, ref: string): string {
  try {
    return git.shortRef(repoPath, ref);
  } catch {
    return '';
  }
}

async function run(
  repoPath: string,
  { defaultProvider, timeoutMs }: { defaultProvider?: string; timeoutMs?: number } = {}
): Promise<string> {
  const baseBranch = git.currentBranch(repoPath);
  const started = new Date();
  const id = runId(started);
  const summaryPath = path.join(repoPath, 'runs', `${id}.md`);
  const logsDir = path.join(repoPath, 'runs', id, 'logs');

  const jobs = loadQueue(repoPath);

  const state: Run = {
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
async function executeJob(
  repoPath: string,
  baseBranch: string,
  job: Job,
  defaultProvider: string | undefined,
  timeoutMs: number | undefined,
  logsDir: string
): Promise<boolean> {
  const effectiveProvider = job.provider || defaultProvider;
  job.providerUsed = effectiveProvider;

  let setupResult: IsolationResult;
  try {
    setupResult = isolation.setup(repoPath, job, baseBranch);
  } catch (err) {
    setupResult = { blocked: `unexpected error during isolation setup: ${(err as Error).message}` };
  }

  if (typeof setupResult.blocked === 'string') {
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
    job.notes = `unexpected runner error: ${(err as Error).message}`;
    job.status = 'blocked';
    writeStatus(job.filePath, 'blocked');
    return job.isolation === 'inline';
  }
}

export { run };
