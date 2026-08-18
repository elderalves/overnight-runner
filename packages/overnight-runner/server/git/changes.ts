import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChangedFile, ChangesPayload, CommitPayload, RunCommit } from 'contract';
import { isSafeGitRef } from './refs.ts';

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

// Run git, never throw -- degradation is the caller's policy. `env` overrides
// (a scratch GIT_INDEX_FILE) merge over the process env.
function git(cwd: string, args: string[], env?: Record<string, string>): Promise<GitResult> {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      args,
      { cwd, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', ...(env ? { env: { ...process.env, ...env } } : {}) },
      (err, stdout, stderr) => resolvePromise({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' })
    );
  });
}

// First line of git's stderr (or stdout) as a one-line human reason.
function gitReason(res: GitResult, fallback: string): string {
  const text = (res.stderr.trim() || res.stdout.trim()).split('\n')[0]?.trim();
  return text || fallback;
}

// ---- structured changes -----------------------------------------------------

// Per-file patch cap -- the GUI shows a "truncated" note past this.
const PATCH_CAP = 200_000;

interface NumstatEntry {
  adds: number;
  dels: number;
  binary: boolean;
  path: string;
  oldPath?: string;
}

// Parse `git diff --numstat -z -M`: `adds TAB dels TAB path NUL`, or for a
// rename/copy `adds TAB dels TAB NUL old NUL new NUL`. Binary files report
// `-` for both counters. Exported for tests.
function parseNumstatZ(out: string): NumstatEntry[] {
  const tokens = out.split('\0');
  const entries: NumstatEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const head = tokens[i] ?? '';
    if (!head) {
      i += 1;
      continue;
    }
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(head);
    if (!m) {
      i += 1;
      continue;
    }
    const binary = m[1] === '-';
    const adds = binary ? 0 : Number(m[1]);
    const dels = m[2] === '-' ? 0 : Number(m[2]);
    if (m[3]) {
      entries.push({ adds, dels, binary, path: m[3] });
      i += 1;
    } else {
      entries.push({ adds, dels, binary, oldPath: tokens[i + 1] ?? '', path: tokens[i + 2] ?? '' });
      i += 3;
    }
  }
  return entries;
}

interface NameStatusEntry {
  status: string;
  path: string;
  oldPath?: string;
}

// Parse `git diff --name-status -z -M`: `X NUL path NUL`, renames/copies
// `Rnnn NUL old NUL new NUL`. Exported for tests.
function parseNameStatusZ(out: string): NameStatusEntry[] {
  const tokens = out.split('\0');
  const entries: NameStatusEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i] ?? '';
    if (!status) {
      i += 1;
      continue;
    }
    if (/^[RC]/.test(status)) {
      entries.push({ status, oldPath: tokens[i + 1] ?? '', path: tokens[i + 2] ?? '' });
      i += 3;
    } else {
      entries.push({ status, path: tokens[i + 1] ?? '' });
      i += 2;
    }
  }
  return entries;
}

// Split one `git diff --patch` blob into per-file sections, in git's file
// order (the same order --numstat/--name-status use). Exported for tests.
function splitPatch(patch: string): string[] {
  if (!patch.trim()) return [];
  const starts: number[] = [];
  const re = /^diff --git /gm;
  for (let m = re.exec(patch); m; m = re.exec(patch)) starts.push(m.index);
  return starts.map((start, idx) => patch.slice(start, starts[idx + 1] ?? patch.length));
}

// Undo git's C-style path quoting (core.quotePath): git wraps paths with
// special bytes in double-quotes and escapes \, ", \t, \n, \r, \f plus octal
// \NNN byte escapes. Unquoted input is returned verbatim.
function unquoteGitPath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return raw;
  const inner = raw.slice(1, -1);
  return inner.replace(/\\([\\"tnrf])|\\([0-7]{3})/g, (_m, esc: string | undefined, oct: string | undefined) => {
    if (oct) return String.fromCharCode(parseInt(oct, 8));
    switch (esc) {
      case 't':
        return '\t';
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 'f':
        return '\f';
      default:
        return esc ?? '';
    }
  });
}

// The new-side ("b/") path a single `git diff` section describes, or null.
function sectionPath(section: string): string | null {
  const renameTo = section.match(/^rename to (.+)$/m) ?? section.match(/^copy to (.+)$/m);
  if (renameTo) return unquoteGitPath(renameTo[1] ?? '');
  const plus = section.match(/^\+\+\+ (.+)$/m);
  if (plus && plus[1] !== '/dev/null') return stripSidePrefix(unquoteGitPath(plus[1] ?? ''));
  const minus = section.match(/^--- (.+)$/m);
  if (minus && minus[1] !== '/dev/null') return stripSidePrefix(unquoteGitPath(minus[1] ?? ''));
  const nl = section.indexOf('\n');
  const header = nl < 0 ? section : section.slice(0, nl);
  const quoted = header.match(/^diff --git (?:"a\/.*"|a\/\S+) (?:"b\/(.*)"|b\/(\S+))$/);
  if (quoted) return unquoteGitPath(quoted[1] != null ? `"${quoted[1]}"` : (quoted[2] ?? ''));
  return null;
}

// Strip the single leading a/ or b/ diff prefix.
function stripSidePrefix(p: string): string {
  return p.replace(/^[ab]\//, '');
}

// Map each `git diff --patch` section to the file path it describes.
// Exported for tests.
function patchByPath(sections: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const section of sections) {
    const path = sectionPath(section);
    if (path != null && !map.has(path)) map.set(path, section);
  }
  return map;
}

function statusWord(letter: string): ChangedFile['status'] {
  switch (letter[0]) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      // M, T (typechange), U -- treated as "modified".
      return 'modified';
  }
}

// Extensions the diff facade shows a small "image" badge for -- there is no
// raw-bytes route in this map (Files tab is out of scope), so this never
// gains an inline preview; it only labels the file honestly.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif']);

function isImagePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

// The three raw `git diff` listings (name-status, numstat, patch) -> the
// {files, stat} payload. Shared by the working-tree diff, the range diff and
// the commit diff below. Exported for tests.
function assemblePayload(nameStatusOut: string, numstatOut: string, patchOut: string, patchCap: number): ChangesPayload {
  const statuses = parseNameStatusZ(nameStatusOut);
  const counts = parseNumstatZ(numstatOut);
  const patches = splitPatch(patchOut);
  const countByPath = new Map(counts.map((entry) => [entry.path, entry]));
  const patchesByPath = patchByPath(patches);
  const alignable = patches.length === statuses.length;

  const files: ChangedFile[] = statuses.map((entry, idx) => {
    const count = countByPath.get(entry.path);
    let patch = patchesByPath.get(entry.path) ?? (alignable ? (patches[idx] ?? '') : '');
    if (patch.length > patchCap) patch = `${patch.slice(0, patchCap)}\n… (patch truncated)`;
    return {
      path: entry.path,
      ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
      status: statusWord(entry.status),
      adds: count?.adds ?? 0,
      dels: count?.dels ?? 0,
      binary: count?.binary ?? false,
      ...(isImagePath(entry.path) ? { image: true } : {}),
      patch,
    };
  });

  return {
    files,
    stat: {
      adds: files.reduce((sum, f) => sum + f.adds, 0),
      dels: files.reduce((sum, f) => sum + f.dels, 0),
      files: files.length,
    },
  };
}

export type ChangesResult = { ok: true; changes: ChangesPayload } | { ok: false; error: string };

// Monotonic suffix for scratch index files, so concurrent /api/git/changes
// calls never share one (each is cleaned up in the finally below).
let scratchSeq = 0;

// The repo-level Git tab's Changes route: the target repo's real working tree
// (staged + unstaged + untracked) vs plain HEAD. Untracked files are surfaced
// via a SCRATCH `GIT_INDEX_FILE` seeded from HEAD + intent-to-add, so a
// read-only browser GET never mutates the user's real git index.
async function collectWorkingTreeChanges(dir: string, opts: { patchCap?: number } = {}): Promise<ChangesResult> {
  const patchCap = opts.patchCap ?? PATCH_CAP;
  const scratchIndex = join(tmpdir(), `overnight-runner-scratch-index-${process.pid}-${scratchSeq++}`);
  const env: Record<string, string> = { GIT_INDEX_FILE: scratchIndex };
  try {
    await git(dir, ['read-tree', 'HEAD'], env); // seed with tracked files; harmless if no HEAD yet
    await git(dir, ['add', '-N', '.'], env);

    const nameStatus = await git(dir, ['diff', '--name-status', '-z', '-M', 'HEAD'], env);
    if (!nameStatus.ok) return { ok: false, error: gitReason(nameStatus, 'git diff failed') };
    const numstat = await git(dir, ['diff', '--numstat', '-z', '-M', 'HEAD'], env);
    if (!numstat.ok) return { ok: false, error: gitReason(numstat, 'git diff failed') };
    const patchOut = await git(dir, ['diff', '--patch', '-M', '--no-color', 'HEAD'], env);
    if (!patchOut.ok) return { ok: false, error: gitReason(patchOut, 'git diff failed') };

    return { ok: true, changes: assemblePayload(nameStatus.stdout, numstat.stdout, patchOut.stdout, patchCap) };
  } finally {
    rmSync(scratchIndex, { force: true });
  }
}

// The per-job Git view's Changes route: a structured diff for exactly
// `jobStartRef..jobEndRef` -- both are full SHAs captured by the runner, so
// no merge-base/scratch-index machinery is needed. See
// per-job-diff-semantics.md.
async function collectRangeChanges(dir: string, startRef: string, endRef: string, patchCap = PATCH_CAP): Promise<ChangesResult> {
  if (!isSafeGitRef(startRef) || !isSafeGitRef(endRef)) return { ok: false, error: 'refusing option-like ref' };
  const nameStatus = await git(dir, ['diff', '--name-status', '-z', '-M', startRef, endRef]);
  if (!nameStatus.ok) return { ok: false, error: gitReason(nameStatus, 'git diff failed') };
  const numstat = await git(dir, ['diff', '--numstat', '-z', '-M', startRef, endRef]);
  if (!numstat.ok) return { ok: false, error: gitReason(numstat, 'git diff failed') };
  const patchOut = await git(dir, ['diff', '--patch', '-M', '--no-color', startRef, endRef]);
  if (!patchOut.ok) return { ok: false, error: gitReason(patchOut, 'git diff failed') };
  return { ok: true, changes: assemblePayload(nameStatus.stdout, numstat.stdout, patchOut.stdout, patchCap) };
}

// ---- commit log --------------------------------------------------------------

export type RunCommitsResult = { ok: true; commits: RunCommit[] } | { ok: false; error: string };

// The commits inside `jobStartRef..jobEndRef`, newest first, capped to
// `limit` when given. Empty (not an error) when the job made no commits.
async function collectRangeCommits(dir: string, startRef: string, endRef: string, limit?: number): Promise<RunCommitsResult> {
  if (!isSafeGitRef(startRef) || !isSafeGitRef(endRef)) return { ok: false, error: 'refusing option-like ref' };
  const args = ['log', '--pretty=format:%H%x1f%s%x1f%an%x1f%cr'];
  if (limit !== undefined) args.push(`-${limit}`);
  args.push(`${startRef}..${endRef}`);
  const log = await git(dir, args);
  if (!log.ok) return { ok: false, error: gitReason(log, 'git log failed') };
  const commits = log.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', subject = '', author = '', when = ''] = line.split('\x1f');
      return { sha, subject, author, when };
    });
  return { ok: true, commits };
}

// ---- commit diffs -------------------------------------------------------------

export type CommitChangesResult = { ok: true; commit: CommitPayload } | { ok: false; error: string };

// Structured diff of ONE commit vs its first parent (--root covers the
// initial commit). A merge commit honestly answers zero files. Unknown/
// invalid shas degrade to { ok:false, error } for the route's 409. Shared by
// the repo-level and per-job commit routes.
async function collectCommitChanges(dir: string, sha: string, patchCap = PATCH_CAP): Promise<CommitChangesResult> {
  if (!/^[0-9a-f]{4,40}$/i.test(sha)) return { ok: false, error: `not a commit hash: ${sha}` };

  const meta = await git(dir, ['show', '-s', '--format=%H%x1f%s%x1f%an%x1f%cr', `${sha}^{commit}`]);
  if (!meta.ok) return { ok: false, error: gitReason(meta, `unknown commit: ${sha}`) };
  const [fullSha = '', subject = '', author = '', when = ''] = meta.stdout.trim().split('\x1f');

  const common = ['diff-tree', '--no-commit-id', '--root', '-r', '-M'];
  const nameStatus = await git(dir, [...common, '--name-status', '-z', fullSha]);
  if (!nameStatus.ok) return { ok: false, error: gitReason(nameStatus, 'git diff-tree failed') };
  const numstat = await git(dir, [...common, '--numstat', '-z', fullSha]);
  if (!numstat.ok) return { ok: false, error: gitReason(numstat, 'git diff-tree failed') };
  const patchOut = await git(dir, [...common, '--patch', '--no-color', fullSha]);
  if (!patchOut.ok) return { ok: false, error: gitReason(patchOut, 'git diff-tree failed') };

  const payload = assemblePayload(nameStatus.stdout, numstat.stdout, patchOut.stdout, patchCap);
  return { ok: true, commit: { sha: fullSha, subject, author, when, ...payload } };
}

export {
  parseNumstatZ,
  parseNameStatusZ,
  splitPatch,
  patchByPath,
  assemblePayload,
  collectWorkingTreeChanges,
  collectRangeChanges,
  collectRangeCommits,
  collectCommitChanges,
  PATCH_CAP,
};
