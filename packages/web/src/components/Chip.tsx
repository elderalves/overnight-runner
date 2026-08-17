import type * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Built on Badge's outline variant. Isolation chips pass the tone matching
// the job's isolation mode; provider chips always pass "neutral" -- no
// per-provider tinting. See design-tokens-component-mapping.md.
type ChipTone = 'worktree' | 'chained' | 'neutral';

const TONE_CLASS: Record<ChipTone, string> = {
  worktree: 'border-violet/35 text-violet',
  chained: 'border-chained/35 text-chained',
  neutral: '',
};

interface ChipProps extends Omit<React.ComponentProps<typeof Badge>, 'variant'> {
  tone?: ChipTone;
}

function Chip({ tone = 'neutral', className, ...props }: ChipProps) {
  return <Badge variant="outline" className={cn(TONE_CLASS[tone], className)} {...props} />;
}

export { Chip };
export type { ChipTone };
