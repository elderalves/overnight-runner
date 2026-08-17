import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { ServeStateProvider } from '@/api/events';
import { ComposerProvider } from '@/components/ComposerContext';
import { AppShell } from '@/components/AppShell';
import { QueueView } from '@/routes/QueueView';
import { HistoryView } from '@/routes/HistoryView';
import { SettingsView } from '@/routes/SettingsView';

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchInterval: false, // SSE says when something changed, not polling
        refetchOnWindowFocus: false,
      },
    },
  });
}

// No basename -- the backend serves index.html for every non-/api GET, so
// deep links survive a refresh. See server-architecture.md's static serving.
function App() {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ServeStateProvider>
        <ComposerProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<QueueView />} />
                <Route path="history" element={<HistoryView />} />
                <Route path="settings" element={<SettingsView />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </ComposerProvider>
      </ServeStateProvider>
    </QueryClientProvider>
  );
}

export { App };
