import { Hono } from 'hono';
import { validator } from 'hono/validator';
import type { BranchRequest, GitResponse } from 'contract';
import { getRepoInfo, getStatus, getBranches, getLog } from '../git/info.ts';
import { collectWorkingTreeChanges, collectCommitChanges } from '../git/changes.ts';
import { createOrSwitchBranch } from '../git/branch.ts';
import { readSettings } from '../../lib/settings.ts';

// GET/POST /api/git -- the repo-level Git tab's backing routes. See
// .alves/issues/overnight-runner-git-feature/backend-git-module-contract.md.
function gitRoutes(repoPath: string) {
  return new Hono()
    .get('/', async (c) => {
      const info = await getRepoInfo(repoPath);
      const baseBranch = readSettings(repoPath).baseBranch;
      if (!info) {
        const payload: GitResponse = { info: null, status: [], log: [], branches: [], baseBranch };
        return c.json(payload);
      }
      const [status, log, branches] = await Promise.all([getStatus(repoPath), getLog(repoPath), getBranches(repoPath)]);
      const payload: GitResponse = { info, status, log, branches, baseBranch };
      return c.json(payload);
    })
    .get('/changes', async (c) => {
      const result = await collectWorkingTreeChanges(repoPath);
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.changes);
    })
    .get('/commit/:sha', async (c) => {
      const result = await collectCommitChanges(repoPath, c.req.param('sha'));
      if (!result.ok) return c.json({ error: result.error }, 409);
      return c.json(result.commit);
    })
    .post(
      '/branch',
      validator('json', (value) => value as BranchRequest),
      async (c) => {
        const { name, from } = c.req.valid('json');
        const result = await createOrSwitchBranch(repoPath, name, from);
        if (!result.ok) return c.json({ error: result.error }, 409);
        return c.json({ branch: result.branch, created: result.created });
      }
    );
}

export { gitRoutes };
