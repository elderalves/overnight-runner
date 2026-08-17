import { useEffect, useState } from 'react';
import type { Job, RunState } from 'contract';
import { StatusPill } from '@/components/StatusPill';
import { Chip } from '@/components/Chip';

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

interface JobDetailProps {
  job: Job;
  run: RunState | null;
  runningJob: { identity: string; startedAt: string; timeoutMs: number } | null;
}

function isolationTone(isolation: string): 'worktree' | 'chained' | 'neutral' {
  if (isolation === 'worktree') return 'worktree';
  if (isolation === 'chained') return 'chained';
  return 'neutral';
}

function JobDetail({ job, run, runningJob }: JobDetailProps) {
  const isActive = runningJob?.identity === job.identity;
  const showFullLog = isActive || job.displayStatus === 'BLOCKED';
  const lines = run?.lines ?? [];
  const visibleLines = showFullLog ? lines : lines.slice(-1);

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

      <div className="flex-1 overflow-auto rounded-md border border-border bg-card-2 p-3 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {visibleLines.length > 0 ? visibleLines.join('\n') : 'No log lines yet.'}
      </div>
    </div>
  );
}

export { JobDetail };
