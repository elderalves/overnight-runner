import { Hono } from 'hono';
import type { ChangesPayload, RunCommitsResponse } from 'contract';
import { listRuns, readRun, findJobRow } from '../../lib/runHistory.ts';
import type { JobRowLookup } from '../../lib/runHistory.ts';
import { collectRangeChanges, collectRangeCommits, collectCommitChanges } from '../git/changes.ts';

const EMPTY_CHANGES: ChangesPayload = { files: [], stat: { adds: 0, dels: 0, files: 0 } };
const DEFAULT_COMMIT_LIMIT = 50;

// Unknown run id vs. unknown job identity both 404, worded to say which.
// See backend-git-module-contract.md's per-job route behavior.
function notFound(lookup: Extract<JobRowLookup, { found: false }>, runId: string, identity: string): string {
  return lookup.reason === 'run-not-found' ? `run "${runId}" not found` : `job "${identity}" not found in run "${runId}"`;
}

// GET /api/runs (list) and /api/runs/:id (detail) -- structured JSON parsed
// server-side from runs/<id>.md. See api-endpoint-contract.md's "History".
//
// Per-job Git routes hang here rather than under /api/git because job
// identity is only meaningful inside a run, and History already owns
// persisted run detail -- see backend-git-module-contract.md. Each uses the
// persisted jobStartRef..jobEndRef range; a job with no complete range (never
// executed this run) gets an empty successful response, feeding the
// already-decided "No changes yet" Changes tab state rather than guessing
// from current branch state.
function historyRoutes(repoPath: string) {
  return new Hono()
    .get('/', (c) => c.json(listRuns(repoPath)))
    .get('/:id', (c) => {
      const run = readRun(repoPath, c.req.param('id'));
      if (!run) return c.json({ error: `run "${c.req.param('id')}" not found` }, 404);
      return c.json(run);
    })
    .get('/:runId/jobs/:identity/changes', async (c) => {
      const { runId, identity } = c.req.param();
      const lookup = findJobRow(repoPath, runId, identity);
      if (!lookup.found) return c.json({ error: notFound(lookup, runId, identity) }, 404);
      if (!lookup.row.jobStartRef || !lookup.row.jobEndRef) return c.json(EMPTY_CHANGES);
      const result = await collectRangeChanges(repoPath, lookup.row.jobStartRef, lookup.row.jobEndRef);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.changes);
    })
    .get('/:runId/jobs/:identity/commits', async (c) => {
      const { runId, identity } = c.req.param();
      const lookup = findJobRow(repoPath, runId, identity);
      if (!lookup.found) return c.json({ error: notFound(lookup, runId, identity) }, 404);
      if (!lookup.row.jobStartRef || !lookup.row.jobEndRef) {
        const empty: RunCommitsResponse = { commits: [] };
        return c.json(empty);
      }
      const limitParam = Number(c.req.query('limit'));
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_COMMIT_LIMIT;
      const result = await collectRangeCommits(repoPath, lookup.row.jobStartRef, lookup.row.jobEndRef, limit);
      if (!result.ok) return c.json({ error: result.error }, 409);
      const payload: RunCommitsResponse = { commits: result.commits };
      return c.json(payload);
    })
    .get('/:runId/jobs/:identity/commit/:sha', async (c) => {
      const { runId, identity, sha } = c.req.param();
      const lookup = findJobRow(repoPath, runId, identity);
      if (!lookup.found) return c.json({ error: notFound(lookup, runId, identity) }, 404);
      const result = await collectCommitChanges(repoPath, sha);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.commit);
    });
}

export { historyRoutes };
