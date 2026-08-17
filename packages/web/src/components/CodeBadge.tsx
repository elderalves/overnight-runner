import type * as React from 'react';
import { cn } from '@/lib/utils';

// A muted, monospace badge for branch/ref-shaped values in table cells --
// cezar's BranchChip treatment (design-tokens-component-mapping.md).
interface CodeBadgeProps {
  children: React.ReactNode;
  className?: string;
}

function CodeBadge({ children, className }: CodeBadgeProps) {
  return (
    <span className={cn('rounded-[6px] bg-muted px-1.5 py-0.5 font-mono text-[11.5px] font-medium text-muted-foreground', className)}>
      {children}
    </span>
  );
}

export { CodeBadge };
