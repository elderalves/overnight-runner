import { useState } from 'react';
import type { JobDisplayStatus } from 'contract';
import { useRun, useRuns } from '@/api/queries';
import { StatusPill } from '@/components/StatusPill';
import { cn } from '@/lib/utils';

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
  open: boolean;
  onToggle: () => void;
}

// Each row expands in place -- local disclosure state, no Radix primitive,
// per design-tokens-component-mapping.md ("nothing decided so far needs
// Collapsible"). Detail only fetches once expanded.
function HistoryRow({ id, status, totals, open, onToggle }: HistoryRowProps) {
  const { data: detail } = useRun(open ? id : null);

  return (
    <div className="mb-2 overflow-hidden rounded-md border border-border">
      <button className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-muted" onClick={onToggle}>
        <span className={cn('text-soft-foreground transition-transform', open && 'rotate-90')}>›</span>
        <span className="font-mono text-xs font-semibold">{id}</span>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{status}</span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">{totals}</span>
      </button>
      {open && detail && (
        <div className="border-t border-border px-3.5 pt-2 pb-3">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-soft-foreground">
                {COLUMNS.map((col) => (
                  <th key={col} className="border-b border-border px-2 py-1 font-semibold">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.jobs.map((row) => (
                <tr key={row.job}>
                  <td className="border-b border-border px-2 py-1 font-mono">{row.job}</td>
                  <td className="border-b border-border px-2 py-1">
                    <StatusPill status={row.status as JobDisplayStatus} />
                  </td>
                  <td className="border-b border-border px-2 py-1 font-mono text-muted-foreground">{row.duration || '—'}</td>
                  <td className="border-b border-border px-2 py-1">{row.isolation}</td>
                  <td className="border-b border-border px-2 py-1 font-mono text-muted-foreground">{row.branchProduced || '—'}</td>
                  <td className="border-b border-border px-2 py-1">{row.provider}</td>
                  <td className="border-b border-border px-2 py-1 font-mono text-muted-foreground">{row.commitRef || '—'}</td>
                  <td className="border-b border-border px-2 py-1">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export { HistoryView };
