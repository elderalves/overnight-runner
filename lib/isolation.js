'use strict';

const path = require('path');
const git = require('./git');

// Sets up the working directory a job's session runs in, per
// .alves/issues/isolation-mode-mechanics.md. Returns either
// { cwd, branchProduced, worktreeDir } or { blocked: <reason> }.
function setup(repoPath, job, baseBranch) {
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
      // job.resolvedBranch is cached at queue-load (see lib/queue.js); chained
      // jobs always get their own fresh worktree checking out that same branch.
      const branch = job.resolvedBranch;
      const worktreeDir = path.join(repoPath, '.worktrees', job.identity);
      git.worktreeAddExisting(repoPath, worktreeDir, branch);
      return { cwd: worktreeDir, branchProduced: branch, worktreeDir };
    }

    return { blocked: `unknown isolation mode "${job.isolation}"` };
  } catch (err) {
    return { blocked: `isolation setup failed: ${err.message}` };
  }
}

// Removes the worktree checkout regardless of PASS/BLOCKED -- the branch itself
// is always kept. No-op for inline jobs (no worktreeDir).
function teardown(repoPath, setupResult) {
  if (setupResult && setupResult.worktreeDir) {
    git.worktreeRemove(repoPath, setupResult.worktreeDir);
  }
}

module.exports = { setup, teardown };
