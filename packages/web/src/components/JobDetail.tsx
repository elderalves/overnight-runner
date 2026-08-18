import { useEffect, useState } from 'react';
import type { JobDisplayStatus, RunState } from 'contract';
import { StatusPill } from '@/components/StatusPill';
import { Chip } from '@/components/Chip';
import { JobChanges } from '@/components/git/JobChanges';
import { JobCommits } from '@/components/git/JobCommits';
import { cn } from '@/lib/utils';

function formatDuration(ms: number): string {
  const totalSec = Math.max(Math.round(ms / 1000), 0);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

interface HeartbeatProps {
  startedAt: string;
  timeoutMs: number;
}

// Ticks its own elapsed/remaining clock every second from job-started's
// startedAt/timeoutMs -- no server-pushed heartbeat, per
// api-endpoint-contract.md's "No server-pushed heartbeat".
function Heartbeat({ startedAt, timeoutMs }: HeartbeatProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - new Date(startedAt).getTime();
  const remaining = Math.max(timeoutMs - elapsed, 0);
  const pct = Math.min((elapsed / timeoutMs) * 100, 100);

  return (
    <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
      <span>{formatDuration(elapsed)} elapsed</span>
      <div className="h-1 w-28 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-pending" style={{ width: `${pct}%` }} />
      </div>
      <span>timeout in {formatDuration(remaining)}</span>
    </div>
  );
}

// A job-like shape both the live wire Job and a historical RunHistoryRow can
// satisfy (via a small adapter at the call site), so Job Detail's tabs are
// genuinely one shared component across Queue's live pinned pane and
// History's nested per-job disclosure -- see git-feature-ia-placement.md.
export interface JobDetailJob {
  identity: string;
  isolation: string;
  provider?: string | null;
  displayStatus: JobDisplayStatus;
  notes?: string;
}

interface JobDetailProps {
  job: JobDetailJob;
  run: RunState | null;
  runningJob: { identity: string; startedAt: string; timeoutMs: number } | null;
  // The run this job's persisted git data (Changes/Commits tabs) belongs to.
  // Null when this job hasn't been touched by any run this session/history
  // view has loaded -- the git tabs then render their empty state without
  // ever fetching. See per-job-diff-semantics.md.
  runId: string | null;
}

function isolationTone(isolation: string): 'worktree' | 'chained' | 'neutral' {
  if (isolation === 'worktree') return 'worktree';
  if (isolation === 'chained') return 'chained';
  return 'neutral';
}

type JobDetailTab = 'log' | 'changes' | 'commits';
const TABS: JobDetailTab[] = ['log', 'changes', 'commits'];

// Job Detail's Log/Changes/Commits tabs -- the first time Job Detail has had
// tabs at all (git-feature-ia-placement.md). Log is today's unchanged
// content; Changes/Commits are new, ported read-only diff/commit surfaces
// wired to /api/runs/:runId/jobs/:identity/* (frontend-git-component-
// port.md). Shared verbatim between Queue's live pinned pane and History's
// nested per-job disclosure.
function JobDetail({ job, run, runningJob, runId }: JobDetailProps) {
  const [tab, setTab] = useState<JobDetailTab>('log');
  const isActive = runningJob?.identity === job.identity;
  const showFullLog = isActive || job.displayStatus === 'BLOCKED';
  const lines = run?.lines ?? [];
  const visibleLines = showFullLog ? lines : lines.slice(-1);
  const logEmptyText = run === null ? 'Log output isn’t available for past runs.' : 'No log lines yet.';

  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <div className="text-sm font-semibold">{job.identity}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <StatusPill status={job.displayStatus} />
          <Chip tone={isolationTone(job.isolation)}>{job.isolation}</Chip>
          {job.provider && <Chip tone="neutral">{job.provider}</Chip>}
        </div>
      </div>

      {isActive && <Heartbeat startedAt={runningJob.startedAt} timeoutMs={runningJob.timeoutMs} />}

      {job.notes && <p className="text-xs text-muted-foreground">{job.notes}</p>}

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-current={tab === t ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-2.5 py-1.5 text-xs font-medium capitalize',
              tab === t ? 'border-foreground font-semibold text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'log' ? (
          <div className="h-full rounded-md border border-border bg-card-2 p-3 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {visibleLines.length > 0 ? visibleLines.join('\n') : logEmptyText}
          </div>
        ) : tab === 'changes' ? (
          <JobChanges runId={runId} identity={job.identity} live={isActive} />
        ) : (
          <JobCommits runId={runId} identity={job.identity} live={isActive} />
        )}
      </div>
    </div>
  );
}

export { JobDetail };
