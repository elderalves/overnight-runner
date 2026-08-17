import type { Job } from './queue.ts';
import { formatDuration } from './runSummary.ts';

// A job's place in the queue, threaded through every progress line as one
// unit -- position and total always travel together.
export interface QueuePosition {
  position: number;
  total: number;
}

// Printed once, before the loop touches job 1 -- see CONTEXT.md's "Progress line".
// Tallies by the post-queue-load `status`, not `initialStatus`: a job that
// fails chain_from validation this run has its status mutated to "blocked"
// before this ever prints, and the tally must agree with the "BLOCKED at
// queue load" line that immediately follows it.
function formatKickoff(runId: string, jobs: Pick<Job, 'status'>[], baseBranch: string): string {
  const pending = jobs.filter((j) => j.status === 'pending').length;
  const done = jobs.filter((j) => j.status === 'done').length;
  const blocked = jobs.filter((j) => j.status === 'blocked').length;
  const plural = jobs.length === 1 ? 'job' : 'jobs';
  return `Run ${runId}: ${jobs.length} ${plural} (${pending} pending, ${done} done, ${blocked} blocked) — base branch ${baseBranch}`;
}

// Printed for a job the run() loop passes over without ever calling
// executeJob(). blockedAtLoad means a chain_from validation failure *this*
// run (job.outcome is already BLOCKED, per runSummary.ts's outcomeFor) --
// distinct from a status already done/blocked from an earlier run.
function formatSkip(job: Pick<Job, 'identity' | 'initialStatus' | 'blockedAtLoad'>, { position, total }: QueuePosition): string {
  if (job.blockedAtLoad) {
    return `[${position}/${total}] ${job.identity} BLOCKED at queue load: ${job.blockedAtLoad}`;
  }
  return `[${position}/${total}] ${job.identity} SKIPPED (already ${job.initialStatus})`;
}

function formatStarted(job: Pick<Job, 'identity' | 'isolation'>, { position, total }: QueuePosition, provider: string | undefined): string {
  return `[${position}/${total}] ${job.identity} started (${job.isolation}, ${provider ?? 'default'})`;
}

function formatHeartbeat(job: Pick<Job, 'identity'>, { position, total }: QueuePosition, elapsedMs: number, timeoutMs: number): string {
  const elapsed = formatDuration(elapsedMs);
  const remaining = formatDuration(Math.max(timeoutMs - elapsedMs, 0));
  return `[${position}/${total}] ${job.identity} still running... ${elapsed} elapsed (timeout in ${remaining})`;
}

// stopping is true only for an inline BLOCKED -- the one outcome that halts
// the rest of the queue (see .alves/issues/queue-format-and-failure-policy.md).
function formatFinished(job: Pick<Job, 'identity' | 'outcome' | 'duration'>, { position, total }: QueuePosition, stopping: boolean): string {
  const duration = job.duration != null ? formatDuration(job.duration) : 'unknown duration';
  const suffix = stopping ? ' — stopping run (inline BLOCKED halts the queue)' : '';
  return `[${position}/${total}] ${job.identity} ${job.outcome} in ${duration}${suffix}`;
}

export { formatKickoff, formatSkip, formatStarted, formatHeartbeat, formatFinished };
