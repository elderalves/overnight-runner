import { useEffect, useRef, useState } from 'react';
import type { DiffStat } from 'contract';
import { cn } from '@/lib/utils';

export function DiffStatLabel({ stat, className }: { stat: DiffStat; className?: string }) {
  const counts = `+${stat.adds} −${stat.dels} across ${stat.files} ${stat.files === 1 ? 'file' : 'files'}`;
  return (
    <span data-slot="diff-stat" title={counts} className={cn('font-mono text-xs font-semibold tabular-nums', className)}>
      <span className="text-success">+{stat.adds}</span> <span className="text-danger">−{stat.dels}</span>
    </span>
  );
}

export function AnimatedDiffStat({ stat }: { stat: DiffStat }) {
  const adds = useAnimatedNumber(stat.adds);
  const dels = useAnimatedNumber(stat.dels);
  return (
    <span data-slot="changes-stat">
      <DiffStatLabel stat={{ adds, dels, files: stat.files }} />
    </span>
  );
}

function useAnimatedNumber(target: number): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    const from = fromRef.current;
    if (from === target) return;
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof requestAnimationFrame !== 'function') {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    const duration = 350;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      setValue(Math.round(from + (target - from) * eased));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      fromRef.current = target;
      setValue(target);
    };
  }, [target]);

  return value;
}
