import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

// Ported from cezar's components/centered-state.tsx (frontend-git-component-
// port.md) -- the one template for every loading/empty/error state the Git
// tab and per-job Git view need: a tinted icon tile, a title, a muted
// subtitle, an actions row.
export type CenteredStateTone = 'neutral' | 'primary' | 'danger';

const tileTone: Record<CenteredStateTone, string> = {
  primary: 'border-primary/25 bg-primary/15 text-primary',
  neutral: 'border-border bg-card text-foreground shadow-xs',
  danger: 'border-danger/20 bg-danger/15 text-danger',
};

export function CenteredState({
  icon,
  tone = 'neutral',
  title,
  subtitle,
  children,
  actions,
  heading: Heading = 'h1',
  className,
}: {
  icon: ReactNode;
  tone?: CenteredStateTone;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  actions?: ReactNode;
  // `h1` when the state IS the page; `h2` when it sits under an existing page heading.
  heading?: 'h1' | 'h2';
  className?: string;
}) {
  return (
    <div
      data-slot="centered-state"
      data-tone={tone}
      className={cn('relative isolate flex min-h-full flex-1 flex-col items-center justify-center px-6 py-12 text-center', className)}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4">
        <div
          data-slot="centered-state-tile"
          className={cn(
            "flex size-[72px] items-center justify-center rounded-[18px] border [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-7",
            tileTone[tone]
          )}
        >
          {icon}
        </div>
        <Heading className="text-2xl font-semibold text-balance text-foreground">{title}</Heading>
        {subtitle ? <p className="text-sm text-pretty text-muted-foreground">{subtitle}</p> : null}
        {children ? <div className="w-full pt-2">{children}</div> : null}
        {actions ? <div className="flex items-center justify-center gap-3 pt-2">{actions}</div> : null}
      </div>
    </div>
  );
}
