import { useMemo, useState } from 'react';
import { Copy, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useServeState } from '@/api/events';
import { useComposer } from '@/components/ComposerContext';
import { StatusPill } from '@/components/StatusPill';
import { Chip } from '@/components/Chip';
import { CodeBadge } from '@/components/CodeBadge';
import { JobDetail } from '@/components/JobDetail';
import { buttonClass, cn } from '@/lib/utils';
import { TD_BASE, TH_BASE } from '@/lib/table';
import { client } from '@/api/client';

function formatDuration(ms?: number): string {
  if (ms == null) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

function isolationTone(isolation: string): 'worktree' | 'chained' | 'neutral' {
  if (isolation === 'worktree') return 'worktree';
  if (isolation === 'chained') return 'chained';
  return 'neutral';
}

const COLUMNS = ['Status', 'Job', 'Isolation', 'Provider', 'Branch', 'Duration', ''];

function QueueView() {
  const { queue, run, runningJob } = useServeState();
  const { openComposer } = useComposer();
  const [selected, setSelected] = useState<string | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const selectedJob = useMemo(() => {
    if (selected) {
      const found = queue.find((j) => j.identity === selected);
      if (found) return found;
    }
    return queue.find((j) => j.identity === runningJob?.identity) ?? queue[queue.length - 1] ?? null;
  }, [queue, selected, runningJob]);

  async function handleDelete(identity: string) {
    if (armedDelete !== identity) {
      setArmedDelete(identity);
      return;
    }
    setArmedDelete(null);
    await client.api.jobs[':identity'].$delete({ param: { identity } });
  }

  async function handleReset(identity: string) {
    await client.api.jobs[':identity'].reset.$post({ param: { identity } });
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex-[1.4] overflow-auto p-4">
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-xs">
          <table className="w-full border-collapse">
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
              {queue.map((job) => (
                <tr
                  key={job.identity}
                  onClick={() => setSelected(job.identity)}
                  className={cn('cursor-pointer hover:bg-muted', selectedJob?.identity === job.identity && 'bg-violet/10')}
                >
                  <td className={TD_BASE}>
                    <StatusPill status={job.displayStatus} />
                  </td>
                  <td className={cn(TD_BASE, 'max-w-[220px] truncate font-mono text-xs')} title={job.identity}>
                    {job.identity}
                  </td>
                  <td className={TD_BASE}>
                    <Chip tone={isolationTone(job.isolation)}>{job.isolation}</Chip>
                  </td>
                  <td className={TD_BASE}>
                    {job.provider ? <Chip tone="neutral">{job.provider}</Chip> : <span className="text-soft-foreground">—</span>}
                  </td>
                  <td className={cn(TD_BASE, 'max-w-[140px] truncate')} title={job.branchProduced}>
                    {job.branchProduced ? <CodeBadge>{job.branchProduced}</CodeBadge> : <span className="text-soft-foreground">—</span>}
                  </td>
                  <td className={cn(TD_BASE, 'font-mono text-xs text-muted-foreground')}>{formatDuration(job.duration)}</td>
                  <td className={TD_BASE} onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-0.5">
                      {job.status === 'blocked' && (
                        <button
                          title="Reset to pending"
                          aria-label="Reset to pending"
                          className={cn(buttonClass('ghost', 'sm'), 'w-7 px-0')}
                          onClick={() => handleReset(job.identity)}
                        >
                          <RotateCcw className="size-3.5" />
                        </button>
                      )}
                      {job.status !== 'done' && (
                        <button
                          title="Edit"
                          aria-label="Edit"
                          className={cn(buttonClass('ghost', 'sm'), 'w-7 px-0')}
                          onClick={() => openComposer('edit', job)}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      )}
                      <button
                        title="Duplicate"
                        aria-label="Duplicate"
                        className={cn(buttonClass('ghost', 'sm'), 'w-7 px-0')}
                        onClick={() => openComposer('duplicate', job)}
                      >
                        <Copy className="size-3.5" />
                      </button>
                      <button
                        title={armedDelete === job.identity ? 'Click again to confirm' : 'Delete'}
                        aria-label="Delete"
                        className={cn(buttonClass('ghost', 'sm'), 'w-7 px-0', armedDelete === job.identity && 'bg-danger/15 text-danger')}
                        onClick={() => handleDelete(job.identity)}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {queue.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-sm text-soft-foreground">
                    No jobs yet — click "+ New job" to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex-1 overflow-auto border-l border-border p-4">
        {selectedJob ? (
          <JobDetail job={selectedJob} run={run} runningJob={runningJob} />
        ) : (
          <p className="text-sm text-soft-foreground">Select a job to see its detail.</p>
        )}
      </div>
    </div>
  );
}

export { QueueView };
