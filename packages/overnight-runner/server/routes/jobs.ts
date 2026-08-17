import { Hono } from 'hono';
import { validator } from 'hono/validator';
import type { JobCreateInput, JobUpdateInput } from 'contract';
import { createJob, updateJob, deleteJob, resetJob, isJobApiError } from '../../lib/jobsApi.ts';
import type { ServeState } from '../runState.ts';

// Pass-through validators -- real business validation (slug format,
// chain_from existence, provider membership) stays in lib/jobsApi.ts. These
// exist only so Hono's `validator()` middleware teaches the RPC client
// (`hc<AppType>()`) the request body's shape; a bare `c.req.json()` in a
// handler body is invisible to that type inference.
const jsonBody = <T>() => validator('json', (value) => value as T);

// POST/PUT/DELETE /api/jobs[/:identity] + /reset -- no GET-by-id and no
// duplicate route, both client-side (the browser already holds the full
// queue array via SSE). See api-endpoint-contract.md's "Job routes".
function jobsRoutes(repoPath: string, state: ServeState) {
  return new Hono()
    .post('/', jsonBody<JobCreateInput>(), (c) => {
      const input = c.req.valid('json');
      try {
        const job = createJob(repoPath, input);
        state.broadcastQueueUpdated();
        return c.json(job);
      } catch (err) {
        if (isJobApiError(err)) {
          if (err.status === 400) return c.json({ errors: err.errors ?? {} }, 400);
          return c.json({ error: err.error ?? 'conflict' }, err.status);
        }
        throw err;
      }
    })
    .put('/:identity', jsonBody<JobUpdateInput>(), (c) => {
      const identity = c.req.param('identity');
      const input = c.req.valid('json');
      try {
        const job = updateJob(repoPath, identity, input);
        state.broadcastQueueUpdated();
        return c.json(job);
      } catch (err) {
        if (isJobApiError(err)) {
          if (err.status === 400) return c.json({ errors: err.errors ?? {} }, 400);
          return c.json({ error: err.error ?? 'conflict' }, err.status);
        }
        throw err;
      }
    })
    .delete('/:identity', (c) => {
      const identity = c.req.param('identity');
      try {
        deleteJob(repoPath, identity);
        state.broadcastQueueUpdated();
        return c.json({ ok: true });
      } catch (err) {
        if (isJobApiError(err)) return c.json({ error: err.error ?? 'not found' }, err.status);
        throw err;
      }
    })
    .post('/:identity/reset', (c) => {
      const identity = c.req.param('identity');
      try {
        const job = resetJob(repoPath, identity);
        state.broadcastQueueUpdated();
        return c.json(job);
      } catch (err) {
        if (isJobApiError(err)) {
          if (err.status === 400) return c.json({ errors: err.errors ?? {} }, 400);
          return c.json({ error: err.error ?? 'conflict' }, err.status);
        }
        throw err;
      }
    });
}

export { jobsRoutes };
