import type { IsolationMode } from './job.ts';

export interface Settings {
  defaultProvider: string;
  defaultTimeoutMinutes: number;
  defaultIsolation: IsolationMode;
  // Configured base branch (distinct from a run's own Base branch fact): future
  // `worktree` jobs fork from it and Git views compare against it. Unset (null)
  // follows the currently checked-out branch -- see
  // .alves/issues/overnight-runner-git-feature/base-branch-configurability.md.
  baseBranch: string | null;
}
