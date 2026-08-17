import path from 'node:path';
import * as runner from '../lib/runner.ts';
import type { RunUpdateEvent } from '../lib/runner.ts';
import { loadQueue } from '../lib/queue.ts';
import type { Job } from '../lib/queue.ts';
import { toWireJob } from '../lib/wireJob.ts';
import { currentBranch } from '../lib/git.ts';
import type {
  Job as WireJob,
  SnapshotEvent,
  QueueUpdatedEvent,
  RunStartedEvent,
  JobStartedEvent,
  JobFinishedEvent,
  JobSkippedEvent,
  RunCompleteEvent,
} from 'contract';

type Listener = (event: string, payload: unknown) => void;

interface InternalRun {
  runId: string;
  status: 'in-progress' | 'complete';
  baseBranch: string;
  provider?: string;
  lines: string[];
  startedAt: string;
  endedAt?: string;
}

// A job's outcome as of the last runner event that touched it, keyed by
// identity. `atStatus` is that job's `initialStatus` at record time --
// getQueue() only trusts a snapshot while the job's current on-disk status
// still matches, so an edit or a "Reset to pending" since then makes a
// stale outcome (e.g. a superseded BLOCKED) fall away on its own, with no
// separate invalidation step needed.
interface JobOutcomeSnapshot {
  outcome: Job['outcome'];
  duration?: number;
  notes: string;
  providerUsed?: string;
  branchProduced?: string;
  commitRef?: string;
  atStatus: string;
}

// The in-process run-state/broadcast manager -- one instance per
// createApp(repoPath) call. getQueue() always re-reads jobs/*.md fresh (no
// fs.watch, no polling -- serve is the sole writer, per server-
// architecture.md) and overlays known run outcomes on top, so a job CRUD'd
// mid-run or right after one finishes is never hidden behind a stale
// in-memory job list.
class ServeState {
  private repoPath: string;
  private repoName: string;
  private currentRun: InternalRun | null = null;
  private outcomes = new Map<string, JobOutcomeSnapshot>();
  private listeners = new Set<Listener>();
  private stopRequested = false;
  private abortController: AbortController | null = null;

  constructor(repoPath: string) {
    this.repoPath = repoPath;
    this.repoName = path.basename(repoPath);
  }

  getQueue(): WireJob[] {
    return loadQueue(this.repoPath).map((job) => {
      const snap = this.outcomes.get(job.identity);
      if (!snap || snap.atStatus !== job.initialStatus) return toWireJob(job, false);
      return toWireJob(
        {
          ...job,
          outcome: snap.outcome,
          duration: snap.duration,
          notes: snap.notes,
          providerUsed: snap.providerUsed,
          branchProduced: snap.branchProduced,
          commitRef: snap.commitRef,
        },
        true
      );
    });
  }

  getSnapshot(): SnapshotEvent {
    return {
      queue: this.getQueue(),
      run: this.currentRun
        ? {
            runId: this.currentRun.runId,
            status: this.currentRun.status,
            baseBranch: this.currentRun.baseBranch,
            provider: this.currentRun.provider,
            lines: this.currentRun.lines,
            startedAt: this.currentRun.startedAt,
            endedAt: this.currentRun.endedAt,
          }
        : null,
      // Read live rather than cached: unlike baseBranch (fixed for a run's
      // lifetime), the target repo's checked-out branch can change between
      // snapshots (a new SSE connection) with no run in progress at all.
      repo: { name: this.repoName, branch: currentBranch(this.repoPath) },
    };
  }

  subscribe(listener: Listener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: Listener): void {
    this.listeners.delete(listener);
  }

  private broadcast(event: string, payload: unknown): void {
    for (const listener of this.listeners) listener(event, payload);
  }

  broadcastQueueUpdated(): void {
    const payload: QueueUpdatedEvent = { queue: this.getQueue() };
    this.broadcast('queue-updated', payload);
  }

  isRunning(): boolean {
    return this.currentRun?.status === 'in-progress';
  }

  // Fire-and-forget: the route handler returns immediately, the run proceeds
  // in the background and broadcasts SSE events as it goes.
  start(defaultProvider: string, timeoutMs: number): void {
    if (this.isRunning()) throw new Error('a run is already in progress');

    this.stopRequested = false;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    void runner.run(this.repoPath, {
      defaultProvider,
      timeoutMs,
      control: { shouldStop: () => this.stopRequested, signal },
      onUpdate: (event) => this.handleRunnerEvent(event),
    });
  }

  requestStop(): void {
    this.stopRequested = true;
  }

  requestCancel(): void {
    this.abortController?.abort();
  }

  private line(text: string): void {
    this.currentRun?.lines.push(text);
  }

  private recordOutcome(job: Job): void {
    this.outcomes.set(job.identity, {
      outcome: job.outcome,
      duration: job.duration,
      notes: job.notes,
      providerUsed: job.providerUsed,
      branchProduced: job.branchProduced,
      commitRef: job.commitRef,
      atStatus: job.initialStatus,
    });
  }

  private handleRunnerEvent(event: RunUpdateEvent): void {
    switch (event.type) {
      case 'run-started': {
        this.currentRun = {
          runId: event.runId,
          status: 'in-progress',
          baseBranch: event.baseBranch,
          provider: event.provider,
          lines: [event.line],
          startedAt: event.startedAt,
        };
        const payload: RunStartedEvent = {
          runId: event.runId,
          jobCount: event.jobCount,
          baseBranch: event.baseBranch,
          provider: event.provider,
          startedAt: event.startedAt,
          line: event.line,
        };
        this.broadcast('run-started', payload);
        break;
      }
      case 'job-started': {
        this.line(event.line);
        this.recordOutcome(event.job); // outcome is 'RUNNING' at this point
        const payload: JobStartedEvent = {
          identity: event.job.identity,
          isolation: event.job.isolation,
          provider: event.job.provider ?? undefined,
          startedAt: event.startedAt,
          timeoutMs: event.timeoutMs,
          queuePosition: event.queuePosition.position,
          queueTotal: event.queuePosition.total,
          line: event.line,
        };
        this.broadcast('job-started', payload);
        break;
      }
      case 'job-finished': {
        this.line(event.line);
        this.recordOutcome(event.job);
        const payload: JobFinishedEvent = {
          identity: event.job.identity,
          outcome: event.job.outcome as 'PASS' | 'BLOCKED',
          duration: event.job.duration ?? 0,
          notes: event.job.notes,
          branchProduced: event.job.branchProduced,
          commitRef: event.job.commitRef,
          providerUsed: event.job.providerUsed,
          stopping: event.stopping,
          line: event.line,
        };
        this.broadcast('job-finished', payload);
        break;
      }
      case 'job-skipped':
      case 'job-blocked-at-load': {
        this.line(event.line);
        this.recordOutcome(event.job);
        const payload: JobSkippedEvent = {
          identity: event.job.identity,
          reason: event.type === 'job-blocked-at-load' ? event.job.blockedAtLoad ?? '' : `already ${event.job.initialStatus}`,
          line: event.line,
        };
        this.broadcast(event.type, payload);
        break;
      }
      case 'run-complete': {
        if (this.currentRun) {
          this.currentRun.status = 'complete';
          this.currentRun.endedAt = event.endedAt;
        }
        const payload: RunCompleteEvent = { runId: event.runId, reason: event.reason, summaryPath: event.summaryPath, endedAt: event.endedAt };
        this.broadcast('run-complete', payload);
        break;
      }
    }
  }
}

export { ServeState };
