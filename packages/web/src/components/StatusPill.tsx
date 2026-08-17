import type { JobDisplayStatus } from 'contract';
import { cn } from '@/lib/utils';

// Dot + tinted label -- not a Badge variant, since the dot and pulse
// animation states aren't things Badge models. Tone mapping per
// design-tokens-component-mapping.md, using the run-outcome vocabulary from
// root CONTEXT.md's "Run outcome" entry plus the two idle-only labels
// (PENDING/DONE) contract's JobDisplayStatus adds on top of it.
const TONE: Record<JobDisplayStatus, { dot: string; label: string; pulse?: boolean }> = {
  PASS: { dot: 'bg-success', label: 'Passed' },
  DONE: { dot: 'bg-success', label: 'Done' },
  RUNNING: { dot: 'bg-violet', label: 'Running', pulse: true },
  BLOCKED: { dot: 'bg-danger', label: 'Blocked' },
  PENDING: { dot: 'bg-soft-foreground', label: 'Pending' },
  'NOT RUN': { dot: 'bg-soft-foreground', label: 'Not run' },
  SKIPPED: { dot: 'bg-soft-foreground', label: 'Skipped' },
};

interface StatusPillProps {
  status: JobDisplayStatus;
  className?: string;
}

function StatusPill({ status, className }: StatusPillProps) {
  const tone = TONE[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground',
        className
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot, tone.pulse && 'animate-pulse')} />
      {tone.label}
    </span>
  );
}

export { StatusPill };
