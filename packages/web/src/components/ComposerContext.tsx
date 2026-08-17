import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Job } from 'contract';
import type { ComposerMode } from '@/components/JobComposer';

interface ComposerRequest {
  mode: ComposerMode;
  job: Job | null;
}

interface ComposerContextValue {
  request: ComposerRequest | null;
  openComposer: (mode: ComposerMode, job?: Job | null) => void;
  closeComposer: () => void;
}

const ComposerContext = createContext<ComposerContextValue | null>(null);

// Shared between the header's "+ New job" button and the queue table's
// per-row Edit/Duplicate actions -- one composer instance, not two.
function ComposerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ComposerRequest | null>(null);

  const value = useMemo<ComposerContextValue>(
    () => ({
      request,
      openComposer: (mode, job = null) => setRequest({ mode, job }),
      closeComposer: () => setRequest(null),
    }),
    [request]
  );

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

function useComposer(): ComposerContextValue {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error('useComposer must be used within ComposerProvider');
  return ctx;
}

export { ComposerProvider, useComposer };
