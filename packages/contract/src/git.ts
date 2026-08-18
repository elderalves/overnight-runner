export interface RepoInfo {
  root: string;
  branch: string;
  remote?: string;
}

export interface StatusEntry {
  status: string;
  path: string;
}

export interface LogEntry {
  hash: string;
  subject: string;
  author: string;
  when: string;
}

export type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface ChangedFile {
  path: string;
  // Rename/copy source -- present only when `status` is renamed/copied.
  oldPath?: string;
  status: ChangedFileStatus;
  adds: number;
  dels: number;
  binary: boolean;
  // True when the path's extension is one the diff facade shows a small
  // "image" badge for. There is no raw-bytes route in this map (Files tab is
  // out of scope), so this never gains an inline preview -- see
  // components/diff/image-preview.tsx in packages/web.
  image?: boolean;
  patch: string;
}

export interface DiffStat {
  adds: number;
  dels: number;
  files: number;
}

export interface ChangesPayload {
  files: ChangedFile[];
  stat: DiffStat;
}

export interface CommitPayload {
  sha: string;
  subject: string;
  author: string;
  // Relative time ("3 hours ago") -- git's `%cr`, same as LogEntry.when.
  when: string;
  files: ChangedFile[];
  stat: DiffStat;
}

export interface RunCommit {
  sha: string;
  subject: string;
  author: string;
  when: string;
}

// GET /api/runs/:runId/jobs/:identity/commits
export interface RunCommitsResponse {
  commits: RunCommit[];
}

// GET /api/git
export interface GitResponse {
  info: RepoInfo | null;
  status: StatusEntry[];
  log: LogEntry[];
  branches: string[];
  baseBranch: string | null;
}

// POST /api/git/branch
export interface BranchRequest {
  name: string;
  from?: string;
}

export interface BranchResponse {
  branch: string;
  created: boolean;
}
