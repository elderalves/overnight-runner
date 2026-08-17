import type { Job } from './job.ts';

// The live-update transport's state shape, backfilled in full on every new
// connection so a tab opened mid-run sees identical history to one that's
// been open the whole time -- see server-architecture.md / api-endpoint-contract.md.
export interface RunState {
  runId: string;
  status: 'in-progress' | 'complete';
  baseBranch: string;
  provider?: string;
  lines: string[];
}

export interface SnapshotEvent {
  queue: Job[];
  run: RunState | null;
}

export interface QueueUpdatedEvent {
  queue: Job[];
}

export interface RunStartedEvent {
  runId: string;
  jobCount: number;
  baseBranch: string;
  provider?: string;
  line: string;
}

export interface JobStartedEvent {
  identity: string;
  isolation: string;
  provider?: string;
  startedAt: string;
  timeoutMs: number;
  queuePosition: number;
  queueTotal: number;
  line: string;
}

export interface JobFinishedEvent {
  identity: string;
  outcome: 'PASS' | 'BLOCKED';
  duration: number;
  notes: string;
  branchProduced?: string;
  commitRef?: string;
  providerUsed?: string;
  stopping: boolean;
  line: string;
}

// Shared shape for both `job-skipped` (already done/blocked from an earlier
// run) and `job-blocked-at-load` (chain_from validation failure this run).
export interface JobSkippedEvent {
  identity: string;
  reason: string;
  line: string;
}

export type RunCompleteReason = 'natural' | 'stopped' | 'cancelled' | 'inline-blocked';

export interface RunCompleteEvent {
  runId: string;
  reason: RunCompleteReason;
  summaryPath: string;
}

export type ServeEvent =
  | { type: 'snapshot'; data: SnapshotEvent }
  | { type: 'queue-updated'; data: QueueUpdatedEvent }
  | { type: 'run-started'; data: RunStartedEvent }
  | { type: 'job-started'; data: JobStartedEvent }
  | { type: 'job-finished'; data: JobFinishedEvent }
  | { type: 'job-skipped'; data: JobSkippedEvent }
  | { type: 'job-blocked-at-load'; data: JobSkippedEvent }
  | { type: 'run-complete'; data: RunCompleteEvent };
