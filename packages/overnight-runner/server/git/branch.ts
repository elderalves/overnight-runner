import { execFile } from 'node:child_process';
import { isSafeGitRef } from './refs.ts';

// Repo-view branch action (POST /api/git/branch), ported from cezar's
// server/git-changes.ts createOrSwitchBranch: switch to `name` when it
// already exists locally, otherwise create it from `from` (or HEAD) and
// switch. Name validation is delegated to `git check-ref-format --branch` --
// git's own rules -- behind an explicit dash-guard. Predictable failures
// (invalid name, unknown `from`, dirty-tree checkout conflict) come back as
// { ok:false, error }.

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function git(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' })
    );
  });
}

function gitReason(res: GitResult, fallback: string): string {
  const text = (res.stderr.trim() || res.stdout.trim()).split('\n')[0]?.trim();
  return text || fallback;
}

export type BranchResult = { ok: true; branch: string; created: boolean } | { ok: false; error: string };

async function createOrSwitchBranch(dir: string, name: string, from?: string): Promise<BranchResult> {
  // Dash-guard: `name` reaches `git checkout <name>` / `git checkout -b <name>`
  // as a positional operand -- check-ref-format already rejects option-like
  // names, and the point is not to rely on that alone.
  if (!isSafeGitRef(name)) return { ok: false, error: `invalid branch name: ${name}` };
  const check = await git(dir, ['check-ref-format', '--branch', name]);
  if (!check.ok) return { ok: false, error: `invalid branch name: ${name}` };

  const exists = await git(dir, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]);
  if (exists.ok) {
    const sw = await git(dir, ['checkout', name]);
    if (!sw.ok) return { ok: false, error: gitReason(sw, `git checkout ${name} failed`) };
    return { ok: true, branch: name, created: false };
  }

  if (from) {
    if (!isSafeGitRef(from)) return { ok: false, error: `invalid start point: ${from}` };
    const start = await git(dir, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`]);
    if (!start.ok) return { ok: false, error: `unknown start point: ${from}` };
  }
  const create = await git(dir, from ? ['checkout', '-b', name, from] : ['checkout', '-b', name]);
  if (!create.ok) return { ok: false, error: gitReason(create, `git checkout -b ${name} failed`) };
  return { ok: true, branch: name, created: true };
}

export { createOrSwitchBranch };
