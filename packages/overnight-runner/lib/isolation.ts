import path from 'node:path';
import * as git from './git.ts';
import type { Job } from './queue.ts';

export interface IsolationOk {
  cwd: string;
  branchProduced: string;
  worktreeDir: string | null;
  blocked?: undefined;
}

export interface IsolationBlocked {
  blocked: string;
  cwd?: undefined;
  branchProduced?: undefined;
  worktreeDir?: undefined;
}

export type IsolationResult = IsolationOk | IsolationBlocked;

// Sets up the working directory a job's session runs in, per
// .alves/issues/isolation-mode-mechanics.md. Returns either
// { cwd, branchProduced, worktreeDir } or { blocked: <reason> }.
function setup(repoPath: string, job: Job, baseBranch: string): IsolationResult {
  try {
    if (job.isolation === 'inline') {
      return { cwd: repoPath, branchProduced: '', worktreeDir: null };
    }

    if (job.isolation === 'worktree') {
      const branch = `overnight/${job.identity}`;
      if (git.branchExists(repoPath, branch)) {
        return { blocked: `branch "${branch}" already exists` };
      }
      const worktreeDir = path.join(repoPath, '.worktrees', job.identity);
      git.worktreeAddNew(repoPath, worktreeDir, branch, baseBranch);
      return { cwd: worktreeDir, branchProduced: branch, worktreeDir };
    }

    if (job.isolation === 'chained') {
      // job.resolvedBranch is cached at queue-load (see lib/queue.ts); chained
      // jobs always get their own fresh worktree checking out that same branch.
      // Non-null: a chained job with no resolvedBranch is always blocked during
      // validateChains and skipped before the runner ever reaches here.
      const branch = job.resolvedBranch!;
      const worktreeDir = path.join(repoPath, '.worktrees', job.identity);
      git.worktreeAddExisting(repoPath, worktreeDir, branch);
      return { cwd: worktreeDir, branchProduced: branch, worktreeDir };
    }

    return { blocked: `unknown isolation mode "${job.isolation}"` };
  } catch (err) {
    return { blocked: `isolation setup failed: ${(err as Error).message}` };
  }
}

// Removes the worktree checkout regardless of PASS/BLOCKED -- the branch itself
// is always kept. No-op for inline jobs (no worktreeDir).
function teardown(repoPath: string, setupResult: IsolationResult): void {
  if (setupResult && setupResult.worktreeDir) {
    git.worktreeRemove(repoPath, setupResult.worktreeDir);
  }
}

export { setup, teardown };
