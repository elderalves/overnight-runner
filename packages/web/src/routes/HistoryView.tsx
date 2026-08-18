import { useState } from 'react';
import type { JobDisplayStatus, RunHistoryRow } from 'contract';
import { useRun, useRuns } from '@/api/queries';
import { StatusPill } from '@/components/StatusPill';
import { CodeBadge } from '@/components/CodeBadge';
import { JobDetail } from '@/components/JobDetail';
import type { JobDetailJob } from '@/components/JobDetail';
import { cn } from '@/lib/utils';
import { TD_BASE, TH_BASE } from '@/lib/table';
import { formatDuration } from '@/lib/duration';

const COLUMNS = ['Job', 'Status', 'Duration', 'Isolation', 'Branch', 'Provider', 'Commit', 'Notes'];

function HistoryView() {
  const { data: runs, isLoading } = useRuns();
  const [openId, setOpenId] = useState<string | null>(null);

  if (isLoading) return <p className="p-4 text-sm text-soft-foreground">Loading…</p>;

  return (
    <div className="flex-1 overflow-auto p-4">
      {(runs ?? []).map((run) => (
        <HistoryRow
          key={run.id}
          id={run.id}
          status={run.runStatus}
          totals={run.totals}
          started={run.started}
          ended={run.ended}
          open={openId === run.id}
          onToggle={() => setOpenId((id) => (id === run.id ? null : run.id))}
        />
      ))}
      {runs?.length === 0 && <p className="text-sm text-soft-foreground">No runs yet.</p>}
    </div>
  );
}

interface HistoryRowProps {
  id: string;
  status: string;
  totals: string;
  started: string;
  ended: string;
  open: boolean;
  onToggle: () => void;
}

// Each row expands in place -- local disclosure state, no Radix primitive,
// per design-tokens-component-mapping.md ("nothing decided so far needs
// Collapsible"). Detail only fetches once expanded.
function HistoryRow({ id, status, totals, started, ended, open, onToggle }: HistoryRowProps) {
  const { data: detail } = useRun(open ? id : null);
  const totalDuration = started && ended ? formatDuration(new Date(ended).getTime() - new Date(started).getTime()) : null;
  // One level deeper than the run row's own click-to-expand: a job row inside
  // an open run can itself disclose its Job Detail tabs (Log/Changes/
  // Commits), the same shared component Queue's live pinned pane uses --
  // see git-feature-ia-placement.md.
  const [openJob, setOpenJob] = useState<string | null>(null);

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border">
      <button className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted" onClick={onToggle}>
        <span className={cn('text-soft-foreground transition-transform', open && 'rotate-90')}>›</span>
        <span className="font-mono text-xs font-semibold">{id}</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{status}</span>
        <span className="flex-1" />
        {totalDuration && <span className="font-mono text-xs text-muted-foreground">{totalDuration}</span>}
        <span className="text-xs text-muted-foreground">{totals}</span>
      </button>
      {open && detail && (
        <div className="border-t border-border px-3.5 pt-2 pb-3">
          <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-xs">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  {COLUMNS.map((col) => (
                    <th key={col} className={TH_BASE}>
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&>tr:last-child>td]:border-b-0">
                {detail.jobs.map((row) => (
                  <JobRow key={row.job} row={row} runId={id} open={openJob === row.job} onToggle={() => setOpenJob((j) => (j === row.job ? null : row.job))} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function toJobDetailJob(row: RunHistoryRow): JobDetailJob {
  return {
    identity: row.job,
    isolation: row.isolation,
    provider: row.provider || null,
    displayStatus: row.status as JobDisplayStatus,
    notes: row.notes,
  };
}

function JobRow({ row, runId, open, onToggle }: { row: RunHistoryRow; runId: string; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-muted" onClick={onToggle}>
        <td className={cn(TD_BASE, 'font-mono')}>
          <span className={cn('mr-1.5 inline-block text-soft-foreground transition-transform', open && 'rotate-90')}>›</span>
          {row.job}
        </td>
        <td className={TD_BASE}>
          <StatusPill status={row.status as JobDisplayStatus} />
        </td>
        <td className={cn(TD_BASE, 'font-mono text-muted-foreground')}>{row.duration || '—'}</td>
        <td className={TD_BASE}>{row.isolation}</td>
        <td className={TD_BASE}>{row.branchProduced ? <CodeBadge>{row.branchProduced}</CodeBadge> : '—'}</td>
        <td className={TD_BASE}>{row.provider}</td>
        <td className={cn(TD_BASE, 'font-mono text-muted-foreground')}>{row.commitRef || '—'}</td>
        <td className={cn(TD_BASE, 'h-auto min-h-11 whitespace-normal py-2')}>{row.notes}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={COLUMNS.length} className="border-b border-border bg-background/40 p-3">
            <div className="h-80">
              <JobDetail job={toJobDetailJob(row)} run={null} runningJob={null} runId={runId} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export { HistoryView };
