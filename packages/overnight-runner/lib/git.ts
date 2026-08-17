import { execFileSync } from 'node:child_process';

function git(repoPath: string, args: string[]): string {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();
}

function currentBranch(repoPath: string): string {
  return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function branchExists(repoPath: string, branch: string): boolean {
  try {
    git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function shortRef(repoPath: string, ref: string): string {
  return git(repoPath, ['rev-parse', '--short', ref]);
}

// Creates a new branch off `base`'s live tip and checks it out into a fresh worktree.
function worktreeAddNew(repoPath: string, worktreeDir: string, branch: string, base: string): void {
  git(repoPath, ['worktree', 'add', '-b', branch, worktreeDir, base]);
}

// Checks out an already-existing branch into a fresh worktree (chained jobs).
function worktreeAddExisting(repoPath: string, worktreeDir: string, branch: string): void {
  git(repoPath, ['worktree', 'add', worktreeDir, branch]);
}

function worktreeRemove(repoPath: string, worktreeDir: string): void {
  try {
    git(repoPath, ['worktree', 'remove', worktreeDir, '--force']);
  } catch (err) {
    console.error(`warning: failed to remove worktree ${worktreeDir}: ${(err as Error).message}`);
  }
}

export { currentBranch, branchExists, shortRef, worktreeAddNew, worktreeAddExisting, worktreeRemove };
