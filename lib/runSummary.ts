import fs from 'node:fs';
import path from 'node:path';
import type { Job } from './queue.ts';

export type RunSummaryJob = Pick<Job, 'identity' | 'isolation' | 'initialStatus' | 'duration' | 'providerUsed' | 'branchProduced' | 'commitRef'> &
  Partial<Pick<Job, 'outcome' | 'provider' | 'notes'>>;

export interface Run {
  runStatus: 'in-progress' | 'complete';
  started: string;
  baseBranch: string;
  provider?: string;
  jobs: RunSummaryJob[];
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

// Run outcome per CONTEXT.md: PASS/BLOCKED mirror this execution's own
// OVERNIGHT_RESULT; SKIPPED means already done/blocked from an earlier run;
// NOT RUN means the queue was cut short before reaching this job.
function outcomeFor(job: RunSummaryJob): 'PASS' | 'BLOCKED' | 'SKIPPED' | 'NOT RUN' {
  if (job.outcome) return job.outcome;
  if (job.initialStatus === 'done' || job.initialStatus === 'blocked') return 'SKIPPED';
  return 'NOT RUN';
}

function renderTotals(jobs: RunSummaryJob[]): string {
  const counts: Record<'PASS' | 'BLOCKED' | 'SKIPPED' | 'NOT RUN', number> = { PASS: 0, BLOCKED: 0, SKIPPED: 0, 'NOT RUN': 0 };
  for (const job of jobs) counts[outcomeFor(job)]++;
  return `${counts.PASS} done, ${counts.BLOCKED} blocked, ${counts.SKIPPED} skipped, ${counts['NOT RUN']} not run`;
}

function escapeCell(value: string): string {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderRow(job: RunSummaryJob): string {
  const cells = [
    job.identity,
    outcomeFor(job),
    job.duration != null ? formatDuration(job.duration) : '',
    job.isolation,
    job.branchProduced || '',
    job.providerUsed || job.provider || '',
    job.commitRef || '',
    job.notes || '',
  ].map(escapeCell);
  return `| ${cells.join(' | ')} |`;
}

function write(summaryPath: string, run: Run): void {
  const { runStatus, started, baseBranch, provider, jobs } = run;
  const header = ['---', `run_status: ${runStatus}`, `started: ${started}`, `base_branch: ${baseBranch}`, `provider: ${provider}`, '---'].join('\n');
  const totals = renderTotals(jobs);
  const tableHeader = '| Job | Status | Duration | Isolation mode | Branch produced | Provider | Commit ref | Notes |';
  const tableDivider = '|---|---|---|---|---|---|---|---|';
  const rows = jobs.map(renderRow);

  const content = [header, '', totals, '', tableHeader, tableDivider, ...rows, ''].join('\n');

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, content);
}

export { write, outcomeFor, formatDuration };
