import { useEffect, useState } from 'react';

function formatDuration(ms: number): string {
  const totalSec = Math.max(Math.round(ms / 1000), 0);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

// Ticks every second while `live` is true, frozen otherwise -- shared by any
// elapsed-time display (job Heartbeat, run-level clock) so they all self-
// correct the same way after a backgrounded tab throttles the interval.
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);

  return now;
}

export { formatDuration, useNow };
