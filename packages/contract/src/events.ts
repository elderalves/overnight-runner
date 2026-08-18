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
  startedAt: string;
  endedAt?: string;
}

export interface RepoIdentity {
  name: string;
  branch: string;
}

export interface SnapshotEvent {
  queue: Job[];
  run: RunState | null;
  repo: RepoIdentity;
}

export interface QueueUpdatedEvent {
  queue: Job[];
}

export interface RunStartedEvent {
  runId: string;
  jobCount: number;
  baseBranch: string;
  provider?: string;
  startedAt: string;
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
  jobStartRef?: string;
  jobEndRef?: string;
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

// One of implement-overnight's 8 fixed loop steps, self-reported via
// `OVERNIGHT_PHASE:` -- see CONTEXT.md's "Phase" for the enumeration. Kept
// as a bare string, not a closed union: the skill that emits it lives
// outside this repo, so the runner stays tolerant of tokens it doesn't
// recognize rather than failing on skill-side drift.
export interface JobPhaseChangedEvent {
  identity: string;
  phase: string;
  line: string;
}

// A short, skill-authored, freeform checkpoint string self-reported via
// `OVERNIGHT_NOTE:` -- see CONTEXT.md's "Activity note". Distinct from a
// Progress line (runner-authored, lifecycle-only) and a Heartbeat (no
// content of its own).
export interface JobActivityNoteEvent {
  identity: string;
  note: string;
  at: string;
  line: string;
}

// A generic, skill-agnostic liveness signal: the most recently changed file
// in the job's worktree, detected by polling `git status --porcelain` --
// works even for jobs that never emit a phase or note.
export interface JobActivityEvent {
  identity: string;
  file: string;
  changedCount: number;
  line: string;
}

export type RunCompleteReason = 'natural' | 'stopped' | 'cancelled' | 'inline-blocked';

export interface RunCompleteEvent {
  runId: string;
  reason: RunCompleteReason;
  summaryPath: string;
  endedAt: string;
}

export type ServeEvent =
  | { type: 'snapshot'; data: SnapshotEvent }
  | { type: 'queue-updated'; data: QueueUpdatedEvent }
  | { type: 'run-started'; data: RunStartedEvent }
  | { type: 'job-started'; data: JobStartedEvent }
  | { type: 'job-phase-changed'; data: JobPhaseChangedEvent }
  | { type: 'job-activity-note'; data: JobActivityNoteEvent }
  | { type: 'job-activity'; data: JobActivityEvent }
  | { type: 'job-finished'; data: JobFinishedEvent }
  | { type: 'job-skipped'; data: JobSkippedEvent }
  | { type: 'job-blocked-at-load'; data: JobSkippedEvent }
  | { type: 'run-complete'; data: RunCompleteEvent };
