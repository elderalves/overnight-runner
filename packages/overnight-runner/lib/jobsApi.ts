import fs from 'node:fs';
import path from 'node:path';
import type { Job as WireJob, JobCreateInput, JobUpdateInput, IsolationMode } from 'contract';
import { writeJobFile, writeStatus } from './frontmatter.ts';
import { loadQueue } from './queue.ts';
import { ADAPTERS } from './providers.ts';
import { toWireJob } from './wireJob.ts';
import { jobsDir } from './paths.ts';

// Thrown by every function below; the Hono route layer catches this shape
// directly and maps it onto api-endpoint-contract.md's HTTP status codes --
// see server/routes/jobs.ts.
export interface JobApiError {
  status: 400 | 404 | 409;
  errors?: Record<string, string>;
  error?: string;
}

function isJobApiError(err: unknown): err is JobApiError {
  return typeof err === 'object' && err !== null && 'status' in err;
}

function badRequest(errors: Record<string, string>): never {
  throw { status: 400, errors } as JobApiError;
}

function conflict(message: string): never {
  throw { status: 409, error: message } as JobApiError;
}

function notFound(message: string): never {
  throw { status: 404, error: message } as JobApiError;
}

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const ISOLATION_MODES: IsolationMode[] = ['inline', 'worktree', 'chained'];

// Shared field validation for create and edit -- slug format/uniqueness is
// create-only (checked by the caller), everything else applies to both.
function validateFields(repoPath: string, fields: JobCreateInput | JobUpdateInput): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!ISOLATION_MODES.includes(fields.isolation)) {
    errors.isolation = `unknown isolation mode "${fields.isolation}" (known: ${ISOLATION_MODES.join(', ')})`;
  }

  if (fields.isolation === 'chained') {
    if (!fields.chainFrom) {
      errors.chainFrom = 'chain_from is required when isolation is "chained"';
    } else if (!loadQueue(repoPath).some((j) => j.identity === fields.chainFrom)) {
      errors.chainFrom = `chain_from target "${fields.chainFrom}" not found in queue`;
    }
  }

  if (fields.provider && !ADAPTERS[fields.provider]) {
    errors.provider = `unknown provider "${fields.provider}" (known: ${Object.keys(ADAPTERS).join(', ')})`;
  }

  return errors;
}

function frontmatterFor(fields: JobCreateInput | JobUpdateInput, status: string): Record<string, string> {
  return {
    isolation: fields.isolation,
    provider: fields.provider ?? '',
    chain_from: fields.isolation === 'chained' ? fields.chainFrom ?? '' : '',
    status,
  };
}

function requireJob(repoPath: string, identity: string) {
  const job = loadQueue(repoPath).find((j) => j.identity === identity);
  if (!job) notFound(`job "${identity}" not found`);
  return job;
}

function createJob(repoPath: string, input: JobCreateInput): WireJob {
  const errors = validateFields(repoPath, input);

  if (!input.slug || !SLUG_PATTERN.test(input.slug)) {
    errors.slug = 'slug must be filename-safe (lowercase letters, numbers, hyphens)';
  } else {
    const collides =
      fs.existsSync(path.join(jobsDir(repoPath), `${input.slug}.md`)) || loadQueue(repoPath).some((j) => j.identity === input.slug);
    if (collides) errors.slug = `"${input.slug}" already exists`;
  }

  if (Object.keys(errors).length > 0) badRequest(errors);

  const filePath = path.join(jobsDir(repoPath), `${input.slug}.md`);
  fs.mkdirSync(jobsDir(repoPath), { recursive: true });
  writeJobFile(filePath, frontmatterFor(input, 'pending'), input.body);

  const created = loadQueue(repoPath).find((j) => j.identity === input.slug)!;
  return toWireJob(created, false);
}

function updateJob(repoPath: string, identity: string, input: JobUpdateInput): WireJob {
  const job = requireJob(repoPath, identity);
  if (job.status === 'done') conflict(`job "${identity}" is done and can't be edited`);

  const errors = validateFields(repoPath, input);
  if (Object.keys(errors).length > 0) badRequest(errors);

  writeJobFile(job.filePath, frontmatterFor(input, job.status), input.body);

  const updated = loadQueue(repoPath).find((j) => j.identity === identity)!;
  return toWireJob(updated, false);
}

function deleteJob(repoPath: string, identity: string): void {
  const job = requireJob(repoPath, identity);
  fs.unlinkSync(job.filePath);
}

function resetJob(repoPath: string, identity: string): WireJob {
  const job = requireJob(repoPath, identity);
  if (job.status !== 'blocked') conflict(`job "${identity}" is not blocked`);

  writeStatus(job.filePath, 'pending');

  const reset = loadQueue(repoPath).find((j) => j.identity === identity)!;
  return toWireJob(reset, false);
}

export { isJobApiError, createJob, updateJob, deleteJob, resetJob };
