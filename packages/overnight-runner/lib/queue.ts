import fs from 'node:fs';
import path from 'node:path';
import { readJobFile, writeStatus, identityFor } from './frontmatter.ts';
import { jobsDir as jobsDirFor } from './paths.ts';

export interface Job {
  file: string;
  filePath: string;
  identity: string;
  isolation: string;
  chainFrom: string | null;
  provider: string | null;
  initialStatus: string;
  status: string;
  body: string;
  resolvedBranch: string | null;
  blockedAtLoad: string | null;
  outcome: 'PASS' | 'BLOCKED' | 'RUNNING' | null;
  notes: string;
  providerUsed?: string;
  duration?: number;
  branchProduced?: string;
  commitRef?: string;
  // Live-only, attached at runtime by ServeState -- never set by loadQueue()
  // itself. See CONTEXT.md's "Phase" / "Activity note" / "Activity".
  currentPhase?: string;
  lastActivityNote?: { text: string; at: string };
  lastActivity?: { file: string; changedCount: number };
  // Full-length start/end refs captured in this job's execution cwd -- see
  // .alves/issues/overnight-runner-git-feature/per-job-diff-semantics.md.
  jobStartRef?: string;
  jobEndRef?: string;
}

// Non-recursive glob of jobs/*.md, lexicographic by filename -- see
// .alves/issues/queue-format-and-failure-policy.md. A jobs/backlog/ subfolder of
// drafts is naturally excluded since readdirSync + isFile() never descends.
function loadQueue(repoPath: string): Job[] {
  const jobsDir = jobsDirFor(repoPath);
  if (!fs.existsSync(jobsDir)) return [];

  const files = fs
    .readdirSync(jobsDir)
    .filter((f) => f.endsWith('.md') && fs.statSync(path.join(jobsDir, f)).isFile())
    .sort();

  const jobs: Job[] = files.map((file) => {
    const filePath = path.join(jobsDir, file);
    const { frontmatter, body } = readJobFile(filePath);
    const status = (frontmatter.status || 'pending').trim();
    return {
      file,
      filePath,
      identity: identityFor(file, frontmatter),
      isolation: (frontmatter.isolation || 'inline').trim(),
      chainFrom: frontmatter.chain_from ? frontmatter.chain_from.trim() : null,
      provider: frontmatter.provider ? frontmatter.provider.trim() : null,
      initialStatus: status,
      status,
      body,
      resolvedBranch: null,
      blockedAtLoad: null,
      outcome: null,
      notes: '',
    };
  });

  validateChains(jobs);
  return jobs;
}

// All BLOCKED-on-failure per .alves/issues/isolation-mode-mechanics.md:
// - chain_from target must exist in the queue
// - target must resolve (through a chain of chained jobs) to a worktree job, never inline
// - target must be the immediate predecessor for that lineage, not a distant/ambiguous ancestor
function validateChains(jobs: Job[]): void {
  const byIdentity = new Map<string, Job>(jobs.map((j) => [j.identity, j]));
  const indexOf = new Map<string, number>(jobs.map((j, i) => [j.identity, i]));
  const referencedBy = new Map<string, string[]>();

  for (const job of jobs) {
    if (job.isolation !== 'chained' || !job.chainFrom) continue;
    if (!referencedBy.has(job.chainFrom)) referencedBy.set(job.chainFrom, []);
    referencedBy.get(job.chainFrom)!.push(job.identity);
  }

  for (const job of jobs) {
    if (job.isolation !== 'chained') continue;

    if (!job.chainFrom) {
      block(job, 'isolation is "chained" but chain_from is missing');
      continue;
    }

    const claimants = referencedBy.get(job.chainFrom) || [];
    if (claimants.length > 1) {
      block(job, `ambiguous chain_from: "${job.chainFrom}" is claimed by multiple jobs (${claimants.join(', ')})`);
      continue;
    }

    const target = byIdentity.get(job.chainFrom);
    if (!target) {
      block(job, `chain_from target "${job.chainFrom}" not found in queue`);
      continue;
    }

    if (indexOf.get(target.identity)! >= indexOf.get(job.identity)!) {
      block(job, `chain_from target "${job.chainFrom}" does not precede this job in queue order`);
      continue;
    }

    const root = resolveRoot(target, byIdentity, referencedBy, job.identity);
    if (typeof root.error === 'string') {
      block(job, root.error);
      continue;
    }
    job.resolvedBranch = `overnight/${root.identity}`;
  }
}

type RootResolution = { identity: string; error?: undefined } | { error: string; identity?: undefined };

// Walks chain_from backward to the root worktree job, caching the branch name
// once at queue-load rather than re-walking at execution time.
function resolveRoot(
  startTarget: Job,
  byIdentity: Map<string, Job>,
  referencedBy: Map<string, string[]>,
  originIdentity: string
): RootResolution {
  let current = startTarget;
  const seen = new Set<string>();

  while (true) {
    if (seen.has(current.identity)) {
      return { error: `circular chain_from detected starting at "${originIdentity}"` };
    }
    seen.add(current.identity);

    if (current.isolation === 'worktree') return { identity: current.identity };

    if (current.isolation !== 'chained') {
      return { error: `chain_from target "${current.identity}" is isolation "${current.isolation}", never inline` };
    }
    if (!current.chainFrom) {
      return { error: `chain_from target "${current.identity}" has no chain_from of its own` };
    }

    const claimants = referencedBy.get(current.chainFrom) || [];
    if (claimants.length > 1) {
      return { error: `ambiguous chain_from upstream of "${current.identity}"` };
    }

    const next = byIdentity.get(current.chainFrom);
    if (!next) {
      return { error: `chain_from target "${current.chainFrom}" not found in queue` };
    }
    current = next;
  }
}

function block(job: Job, reason: string): void {
  job.status = 'blocked';
  job.blockedAtLoad = reason;
  job.outcome = 'BLOCKED';
  job.notes = reason;
  writeStatus(job.filePath, 'blocked');
}

export { loadQueue };
