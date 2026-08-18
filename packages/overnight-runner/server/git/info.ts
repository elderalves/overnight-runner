import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoInfo, StatusEntry, LogEntry } from 'contract';

// Repo-level read helpers for the Git tab, ported from cezar's server/git.ts
// (backend-git-module-contract.md): every function takes a plain directory
// path and shells out via execFile, with zero app-state coupling.

const exec = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

// Null when `dir` isn't inside a git repository.
async function getRepoInfo(dir: string): Promise<RepoInfo | null> {
  try {
    const root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
    const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    let remote: string | undefined;
    try {
      remote = (await git(root, ['remote', 'get-url', 'origin'])).trim() || undefined;
    } catch {
      try {
        const names = (await git(root, ['remote'])).split('\n').map((n) => n.trim()).filter(Boolean);
        if (names[0]) {
          remote = (await git(root, ['remote', 'get-url', names[0]])).trim() || undefined;
        }
      } catch {
        // no remotes at all -- local-only repo
      }
    }
    return { root, branch, remote };
  } catch {
    return null;
  }
}

async function getStatus(root: string): Promise<StatusEntry[]> {
  const out = await git(root, ['status', '--porcelain']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim() || '??', path: line.slice(3) }));
}

// Local + origin branch names, deduped (origin/x counts as x), sorted.
// Feeds the Git tab's branch list and base-branch picker. Branches under
// `overnight/` are the runner's own per-worktree-job bookkeeping (isolation.ts)
// and are filtered out, mirroring cezar's own `cez/` filter.
async function getBranches(root: string): Promise<string[]> {
  const names = new Set<string>();
  try {
    const local = await git(root, ['branch', '--list', '--format=%(refname:short)']);
    for (const line of local.split('\n')) {
      const name = line.trim();
      if (name) names.add(name);
    }
  } catch {
    // no branches -- empty list
  }
  try {
    const remote = await git(root, ['branch', '-r', '--list', '--format=%(refname:short)']);
    for (const line of remote.split('\n')) {
      const name = line.trim();
      if (!name || name.includes('HEAD')) continue;
      names.add(name.replace(/^origin\//, ''));
    }
  } catch {
    // no remotes -- local only
  }
  return [...names].filter((n) => !n.startsWith('overnight/')).sort((a, b) => a.localeCompare(b));
}

async function getLog(root: string, count = 20): Promise<LogEntry[]> {
  const out = await git(root, ['log', `-${count}`, '--pretty=format:%h%x1f%s%x1f%an%x1f%cr']);
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash = '', subject = '', author = '', when = ''] = line.split('\x1f');
      return { hash, subject, author, when };
    });
}

export { getRepoInfo, getStatus, getBranches, getLog };
