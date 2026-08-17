import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Job,
  RunState,
  RepoIdentity,
  SnapshotEvent,
  QueueUpdatedEvent,
  RunStartedEvent,
  JobStartedEvent,
  JobFinishedEvent,
  JobSkippedEvent,
} from 'contract';

interface RunningJob {
  identity: string;
  startedAt: string;
  timeoutMs: number;
}

interface ServeState {
  queue: Job[];
  run: RunState | null;
  connected: boolean;
  // job-started's startedAt/timeoutMs, kept only for the job currently in
  // flight -- the detail pane ticks its own elapsed/remaining clock from
  // this every second, no server-pushed heartbeat needed. A tab that
  // connects mid-job won't have this until the *next* job starts (the
  // snapshot doesn't backfill it) -- an accepted gap, same shape as
  // server-architecture.md's own documented ones.
  runningJob: RunningJob | null;
  // Null until the first snapshot arrives -- the sidebar chip is simply
  // absent rather than showing an invented repo name.
  repo: RepoIdentity | null;
}

const EMPTY_STATE: ServeState = { queue: [], run: null, connected: false, runningJob: null, repo: null };

const ServeStateContext = createContext<ServeState | null>(null);

function useServeState(): ServeState {
  const ctx = useContext(ServeStateContext);
  if (!ctx) throw new Error('useServeState must be used within ServeStateProvider');
  return ctx;
}

function patchJob(state: ServeState, identity: string, patch: Partial<Job>): ServeState {
  return { ...state, queue: state.queue.map((job) => (job.identity === identity ? { ...job, ...patch } : job)) };
}

function appendLine(state: ServeState, line: string): ServeState {
  if (!state.run) return state;
  return { ...state, run: { ...state.run, lines: [...state.run.lines, line] } };
}

// One EventSource for the app's lifetime, folded into React state and shared
// via context so the sidebar's "this run" mini-list and the Queue view's
// table/detail pane consume the same live feed. See server-architecture.md /
// api-endpoint-contract.md's SSE event list.
function ServeStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ServeState>(EMPTY_STATE);

  useEffect(() => {
    let source: EventSource | null = null;

    function connect() {
      source?.close();
      source = new globalThis.EventSource('/api/events');

      source.addEventListener('snapshot', (e) => {
        const data: SnapshotEvent = JSON.parse((e as MessageEvent).data);
        setState({ queue: data.queue, run: data.run, connected: true, runningJob: null, repo: data.repo });
      });

      source.addEventListener('queue-updated', (e) => {
        const data: QueueUpdatedEvent = JSON.parse((e as MessageEvent).data);
        setState((prev) => ({ ...prev, queue: data.queue }));
      });

      source.addEventListener('run-started', (e) => {
        const data: RunStartedEvent = JSON.parse((e as MessageEvent).data);
        setState((prev) => ({
          ...prev,
          run: { runId: data.runId, status: 'in-progress', baseBranch: data.baseBranch, provider: data.provider, lines: [data.line] },
        }));
      });

      source.addEventListener('job-started', (e) => {
        const data: JobStartedEvent = JSON.parse((e as MessageEvent).data);
        setState((prev) => ({
          ...appendLine(patchJob(prev, data.identity, { displayStatus: 'RUNNING' }), data.line),
          runningJob: { identity: data.identity, startedAt: data.startedAt, timeoutMs: data.timeoutMs },
        }));
      });

      source.addEventListener('job-finished', (e) => {
        const data: JobFinishedEvent = JSON.parse((e as MessageEvent).data);
        setState((prev) => ({
          ...appendLine(
            patchJob(prev, data.identity, {
              displayStatus: data.outcome,
              notes: data.notes,
              branchProduced: data.branchProduced,
              commitRef: data.commitRef,
              providerUsed: data.providerUsed,
              duration: data.duration,
            }),
            data.line
          ),
          runningJob: prev.runningJob?.identity === data.identity ? null : prev.runningJob,
        }));
      });

      source.addEventListener('job-skipped', (e) => {
        const data: JobSkippedEvent = JSON.parse((e as MessageEvent).data);
        setState((prev) => appendLine(patchJob(prev, data.identity, { displayStatus: 'SKIPPED', notes: data.reason }), data.line));
      });

      // A chain_from validation failure this run -- a fresh BLOCKED event,
      // not a carryover, matching outcomeFor()'s own treatment (its
      // job.outcome is already 'BLOCKED', set at queue-load).
      source.addEventListener('job-blocked-at-load', (e) => {
        const data: JobSkippedEvent = JSON.parse((e as MessageEvent).data);
        setState((prev) => appendLine(patchJob(prev, data.identity, { displayStatus: 'BLOCKED', notes: data.reason }), data.line));
      });

      source.addEventListener('run-complete', () => {
        setState((prev) => ({ ...prev, run: prev.run ? { ...prev.run, status: 'complete' } : prev.run, runningJob: null }));
      });

      source.onopen = () => setState((prev) => ({ ...prev, connected: true }));
      source.onerror = () => setState((prev) => ({ ...prev, connected: false }));
    }

    // bfcache restoration can leave a dead connection the browser never
    // auto-reconnects (the page was frozen, not closed) -- force a fresh
    // connect on visibility/pageshow
    function onVisible() {
      if (document.visibilityState === 'visible') connect();
    }

    connect();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', onVisible);
      source?.close();
    };
  }, []);

  return <ServeStateContext.Provider value={state}>{children}</ServeStateContext.Provider>;
}

export { ServeStateProvider, useServeState };
export type { ServeState };
