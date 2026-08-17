import path from 'node:path';

// Single source of truth for the directory every runner-created artifact
// (jobs/, runs/, worktrees/, settings.json) lives under in the target repo --
// see lib/migrate.ts for how a pre-existing flat layout gets moved into it.
const ROOT_DIR = '.overnight-runner';

function rootDir(repoPath: string): string {
  return path.join(repoPath, ROOT_DIR);
}

function jobsDir(repoPath: string): string {
  return path.join(rootDir(repoPath), 'jobs');
}

function runsDir(repoPath: string): string {
  return path.join(rootDir(repoPath), 'runs');
}

export { ROOT_DIR, rootDir, jobsDir, runsDir };
