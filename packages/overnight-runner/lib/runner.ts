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
import * as progress from './progress.ts';

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

// Threaded in by serve mode only -- the plain CLI passes neither, so its
// behavior (run to natural completion, no early-stop reason to report) is
// unaffected. shouldStop() is polled at the top of each loop iteration
// (graceful Stop); signal is handed down into the in-flight child process
// for an immediate kill (Cancel) -- see run-control-semantics.md.
export interface RunControl {
  shouldStop(): boolean;
  signal: AbortSignal;
}

export type RunCompleteReason = 'natural' | 'stopped' | 'cancelled' | 'inline-blocked';

// A concretization of server-architecture.md's `onUpdate: (run: Run) => void`
// sketch: a bare Run snapshot can't carry job-started's queuePosition/
// timeoutMs/pre-rendered line without the listener re-deriving them, so this
// carries exactly what api-endpoint-contract.md's SSE payloads need instead.
export type RunUpdateEvent =
  | { type: 'run-started'; runId: string; jobCount: number; baseBranch: string; provider?: string; line: string }
  | { type: 'job-started'; job: Job; queuePosition: progress.QueuePosition; timeoutMs: number; startedAt: string; line: string }
  | { type: 'job-skipped'; job: Job; queuePosition: progress.QueuePosition; line: string }
  | { type: 'job-blocked-at-load'; job: Job; queuePosition: progress.QueuePosition; line: string }
  | { type: 'job-finished'; job: Job; queuePosition: progress.QueuePosition; stopping: boolean; line: string }
  | { type: 'run-complete'; runId: string; reason: RunCompleteReason; summaryPath: string };

async function run(
  repoPath: string,
  {
    defaultProvider,
    timeoutMs,
    onUpdate,
    control,
  }: { defaultProvider?: string; timeoutMs?: number; onUpdate?: (event: RunUpdateEvent) => void; control?: RunControl } = {}
): Promise<string> {
  const baseBranch = git.currentBranch(repoPath);
  const started = new Date();
  const id = runId(started);
  const summaryPath = path.join(repoPath, 'runs', `${id}.md`);
  const logsDir = path.join(repoPath, 'runs', id, 'logs');

  const jobs = loadQueue(repoPath);
  const kickoffLine = progress.formatKickoff(id, jobs, baseBranch);
  console.log(kickoffLine);

  const state: Run = {
    runStatus: 'in-progress',
    started: started.toISOString(),
    baseBranch,
    provider: defaultProvider,
    jobs,
  };
  runSummary.write(summaryPath, state);
  onUpdate?.({ type: 'run-started', runId: id, jobCount: jobs.length, baseBranch, provider: defaultProvider, line: kickoffLine });

  let completionReason: RunCompleteReason = 'natural';

  for (let i = 0; i < jobs.length; i++) {
    if (control?.signal.aborted) {
      completionReason = 'cancelled';
      break;
    }
    if (control?.shouldStop()) {
      completionReason = 'stopped';
      break;
    }

    const job = jobs[i]!;
    const queuePosition: progress.QueuePosition = { position: i + 1, total: jobs.length };

    // Already done/blocked from an earlier run (SKIPPED), or blocked at
    // queue-load this run (chain_from validation) -- neither executes.
    if (job.initialStatus === 'done' || job.initialStatus === 'blocked' || job.blockedAtLoad) {
      const skipLine = progress.formatSkip(job, queuePosition);
      console.log(skipLine);
      onUpdate?.({ type: job.blockedAtLoad ? 'job-blocked-at-load' : 'job-skipped', job, queuePosition, line: skipLine });
      continue;
    }

    const effectiveTimeoutMs = timeoutMs || providers.DEFAULT_TIMEOUT_MS;
    const startedAt = new Date().toISOString();
    const startedLine = progress.formatStarted(job, queuePosition, job.provider || defaultProvider);
    console.log(startedLine);
    job.outcome = 'RUNNING';
    runSummary.write(summaryPath, state);
    onUpdate?.({ type: 'job-started', job, queuePosition, timeoutMs: effectiveTimeoutMs, startedAt, line: startedLine });

    const stop = await executeJob(repoPath, baseBranch, job, defaultProvider, timeoutMs, logsDir, queuePosition, control?.signal);
    runSummary.write(summaryPath, state);
    const finishedLine = progress.formatFinished(job, queuePosition, stop);
    console.log(finishedLine);
    onUpdate?.({ type: 'job-finished', job, queuePosition, stopping: stop, line: finishedLine });

    if (control?.signal.aborted) {
      completionReason = 'cancelled';
      break;
    }
    if (stop) {
      completionReason = 'inline-blocked';
      break; // inline BLOCKED stops the run; remaining jobs report NOT RUN
    }
  }

  state.runStatus = 'complete';
  runSummary.write(summaryPath, state);
  onUpdate?.({ type: 'run-complete', runId: id, reason: completionReason, summaryPath });
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
  logsDir: string,
  queuePosition: progress.QueuePosition,
  signal?: AbortSignal
): Promise<boolean> {
  const effectiveProvider = job.provider || defaultProvider;
  job.providerUsed = effectiveProvider;
  const startTime = Date.now();

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
    job.duration = Date.now() - startTime;
    writeStatus(job.filePath, 'blocked');
    return job.isolation === 'inline';
  }

  try {
    const prompt = providers.buildPrompt(effectiveProvider, job.filePath);
    const logPath = path.join(logsDir, `${job.identity}.log`);

    const result = await providers.runProvider(effectiveProvider, prompt, setupResult.cwd, {
      timeoutMs,
      logPath,
      signal,
      onHeartbeat: (elapsedMs, effectiveTimeoutMs) => {
        console.log(progress.formatHeartbeat(job, queuePosition, elapsedMs, effectiveTimeoutMs));
      },
    });
    job.duration = Date.now() - startTime;

    isolation.teardown(repoPath, setupResult);

    job.outcome = result.result;
    job.notes = result.reason || '';
    job.branchProduced = setupResult.branchProduced;
    job.commitRef = safeShortRef(repoPath, job.branchProduced || 'HEAD');

    // Cancel kills the child before the skill ever gets to write its own
    // status -- the runner must write it, same shape as the isolation-setup
    // and unknown-provider cases below, forcing "blocked" rather than the
    // free pending/auto-retry a timeout leaves. See run-control-semantics.md.
    if (result.cancelled) {
      job.status = 'blocked';
      writeStatus(job.filePath, 'blocked');
    }

    return job.isolation === 'inline' && job.outcome === 'BLOCKED';
  } catch (err) {
    // Only reachable when the provider process itself never started (e.g. an
    // unknown provider name) -- the skill never ran, so nothing else will ever
    // write this job's status; the runner must, same as the isolation-blocked case.
    isolation.teardown(repoPath, setupResult);
    job.outcome = 'BLOCKED';
    job.notes = `unexpected runner error: ${(err as Error).message}`;
    job.status = 'blocked';
    job.duration = Date.now() - startTime;
    writeStatus(job.filePath, 'blocked');
    return job.isolation === 'inline';
  }
}

export { run };
