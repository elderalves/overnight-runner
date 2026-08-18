import { useEffect, useState } from 'react';

// md-and-up, live: the "phones force unified+wrap" rule (frontend-git-
// component-port.md) must follow a rotation/resize, not just the first
// render. jsdom (no matchMedia) counts as desktop. Ported from cezar's
// lib/use-desktop.ts.
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(
    () => typeof window.matchMedia !== 'function' || window.matchMedia('(min-width: 768px)').matches
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => setDesktop(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return desktop;
}

export { useIsDesktop };
