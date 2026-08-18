import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BranchRequest, BranchResponse, ChangesPayload, CommitPayload, GitResponse, RunCommitsResponse, RunHistoryDetail, RunHistorySummary, Settings } from 'contract';
import { client, throwOnError } from './client.ts';

// The REST-ish, non-live views only -- queue/run state comes from SSE
// (./events.tsx), not react-query, per frontend-stack.md.
const queryKeys = {
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  settings: ['settings'] as const,
  git: ['git'] as const,
  gitChanges: ['git', 'changes'] as const,
  gitCommit: (sha: string) => ['git', 'commit', sha] as const,
  jobChanges: (runId: string, identity: string) => ['runs', runId, 'jobs', identity, 'changes'] as const,
  jobCommits: (runId: string, identity: string) => ['runs', runId, 'jobs', identity, 'commits'] as const,
  jobCommit: (runId: string, identity: string, sha: string) => ['runs', runId, 'jobs', identity, 'commit', sha] as const,
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

// --- Git tab (repo-level) ---

function useGit() {
  return useQuery({
    queryKey: queryKeys.git,
    queryFn: async (): Promise<GitResponse> => {
      const res = await client.api.git.$get();
      if (!res.ok) return throwOnError(res, 'failed to load git info');
      return res.json();
    },
  });
}

// The main working tree's structured diff. A 409 ("not a git repository") is
// an answer, not a hiccup -- retries are off.
function useGitChanges() {
  return useQuery({
    queryKey: queryKeys.gitChanges,
    queryFn: async (): Promise<ChangesPayload> => {
      const res = await client.api.git.changes.$get();
      if (!res.ok) return throwOnError(res, 'failed to load changes');
      return res.json();
    },
    retry: false,
  });
}

function useGitCommit(sha: string | null) {
  return useQuery({
    queryKey: queryKeys.gitCommit(sha ?? ''),
    queryFn: async (): Promise<CommitPayload> => {
      const res = await client.api.git.commit[':sha'].$get({ param: { sha: sha! } });
      if (!res.ok) return throwOnError(res, 'failed to load commit');
      return res.json();
    },
    enabled: sha !== null,
    retry: false,
  });
}

function useCreateOrSwitchBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BranchRequest): Promise<BranchResponse> => {
      const res = await client.api.git.branch.$post({ json: input });
      if (!res.ok) return throwOnError(res, 'failed to switch branch');
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.git });
    },
  });
}

// --- per-job Git view (Job Detail's Changes/Commits tabs) ---

// `live` polls while the relevant job is currently running, matching the
// successful-empty-response convention for a job with no persisted
// jobStartRef..jobEndRef range yet (frontend-git-component-port.md).
function useJobChanges(runId: string | null, identity: string | null, live = false) {
  return useQuery({
    queryKey: queryKeys.jobChanges(runId ?? '', identity ?? ''),
    queryFn: async (): Promise<ChangesPayload> => {
      const res = await client.api.runs[':runId'].jobs[':identity'].changes.$get({ param: { runId: runId!, identity: identity! } });
      if (!res.ok) return throwOnError(res, 'failed to load job changes');
      return res.json();
    },
    enabled: Boolean(runId) && Boolean(identity),
    retry: false,
    refetchInterval: live ? 4000 : false,
  });
}

function useJobCommits(runId: string | null, identity: string | null, live = false) {
  return useQuery({
    queryKey: queryKeys.jobCommits(runId ?? '', identity ?? ''),
    queryFn: async (): Promise<RunCommitsResponse> => {
      const res = await client.api.runs[':runId'].jobs[':identity'].commits.$get({ param: { runId: runId!, identity: identity! } });
      if (!res.ok) return throwOnError(res, 'failed to load job commits');
      return res.json();
    },
    enabled: Boolean(runId) && Boolean(identity),
    retry: false,
    refetchInterval: live ? 5000 : false,
  });
}

function useJobCommit(runId: string | null, identity: string | null, sha: string | null) {
  return useQuery({
    queryKey: sha ? queryKeys.jobCommit(runId ?? '', identity ?? '', sha) : ['runs', runId ?? '', 'jobs', identity ?? '', 'commit'],
    queryFn: async (): Promise<CommitPayload> => {
      const res = await client.api.runs[':runId'].jobs[':identity'].commit[':sha'].$get({ param: { runId: runId!, identity: identity!, sha: sha! } });
      if (!res.ok) return throwOnError(res, 'failed to load commit');
      return res.json();
    },
    enabled: Boolean(runId) && Boolean(identity) && Boolean(sha),
    retry: false,
  });
}

export {
  useRuns,
  useRun,
  useSettings,
  useSaveSettings,
  useGit,
  useGitChanges,
  useGitCommit,
  useCreateOrSwitchBranch,
  useJobChanges,
  useJobCommits,
  useJobCommit,
};
