import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RunHistoryDetail, RunHistorySummary, Settings } from 'contract';
import { client } from './client.ts';

// The REST-ish, non-live views only -- queue/run state comes from SSE
// (./events.tsx), not react-query, per frontend-stack.md.
const queryKeys = {
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  settings: ['settings'] as const,
};

function useRuns() {
  return useQuery({
    queryKey: queryKeys.runs,
    queryFn: async (): Promise<RunHistorySummary[]> => {
      const res = await client.api.runs.$get();
      if (!res.ok) throw new Error('failed to load run history');
      return res.json();
    },
  });
}

function useRun(id: string | null) {
  return useQuery({
    queryKey: queryKeys.run(id ?? ''),
    queryFn: async (): Promise<RunHistoryDetail> => {
      const res = await client.api.runs[':id'].$get({ param: { id: id! } });
      if (!res.ok) throw new Error('failed to load run detail');
      return res.json();
    },
    enabled: id !== null,
  });
}

function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async (): Promise<Settings> => {
      const res = await client.api.settings.$get();
      if (!res.ok) throw new Error('failed to load settings');
      return res.json();
    },
  });
}

function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Settings): Promise<Settings> => {
      const res = await client.api.settings.$put({ json: settings });
      if (!res.ok) throw new Error('failed to save settings');
      return res.json();
    },
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.settings, settings);
    },
  });
}

export { useRuns, useRun, useSettings, useSaveSettings };
