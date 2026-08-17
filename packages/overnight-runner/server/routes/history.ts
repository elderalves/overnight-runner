import { Hono } from 'hono';
import { listRuns, readRun } from '../../lib/runHistory.ts';

// GET /api/runs (list) and /api/runs/:id (detail) -- structured JSON parsed
// server-side from runs/<id>.md. See api-endpoint-contract.md's "History".
function historyRoutes(repoPath: string) {
  return new Hono()
    .get('/', (c) => c.json(listRuns(repoPath)))
    .get('/:id', (c) => {
      const run = readRun(repoPath, c.req.param('id'));
      if (!run) return c.json({ error: `run "${c.req.param('id')}" not found` }, 404);
      return c.json(run);
    });
}

export { historyRoutes };
