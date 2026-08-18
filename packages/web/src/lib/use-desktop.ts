import { useEffect, useState } from 'react';

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
