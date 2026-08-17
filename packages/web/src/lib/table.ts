// cezar's table row/cell rhythm (design-tokens-component-mapping.md): a
// fixed row height with border-b, denser edge padding on the first/last
// column than the ones in between. Shared by QueueView and HistoryView so
// the two tables can't drift apart the way two hand-copied constants would.
export const TD_BASE = 'h-11 border-b border-border px-2.5 whitespace-nowrap first:pl-4 last:pr-4';
export const TH_BASE =
  'h-[38px] border-b border-border px-2.5 text-left text-[11px] font-semibold tracking-[0.05em] whitespace-nowrap text-soft-foreground uppercase first:pl-4 last:pr-4';
