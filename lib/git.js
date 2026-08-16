'use strict';

const { execFileSync } = require('child_process');

function git(repoPath, args) {
  return execFileSync('git', ['-C', repoPath, ...args], { encoding: 'utf8' }).trim();
}

function currentBranch(repoPath) {
  return git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
}

function branchExists(repoPath, branch) {
  try {
    git(repoPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

function shortRef(repoPath, ref) {
  return git(repoPath, ['rev-parse', '--short', ref]);
}

// Creates a new branch off `base`'s live tip and checks it out into a fresh worktree.
function worktreeAddNew(repoPath, worktreeDir, branch, base) {
  git(repoPath, ['worktree', 'add', '-b', branch, worktreeDir, base]);
}

// Checks out an already-existing branch into a fresh worktree (chained jobs).
function worktreeAddExisting(repoPath, worktreeDir, branch) {
  git(repoPath, ['worktree', 'add', worktreeDir, branch]);
}

function worktreeRemove(repoPath, worktreeDir) {
  try {
    git(repoPath, ['worktree', 'remove', worktreeDir, '--force']);
  } catch (err) {
    console.error(`warning: failed to remove worktree ${worktreeDir}: ${err.message}`);
  }
}

module.exports = {
  currentBranch,
  branchExists,
  shortRef,
  worktreeAddNew,
  worktreeAddExisting,
  worktreeRemove,
};
