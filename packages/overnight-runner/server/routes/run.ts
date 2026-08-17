import { Hono } from 'hono';
import { readSettings } from '../../lib/settings.ts';
import type { ServeState } from '../runState.ts';

// POST /api/run/{start,stop,cancel} -- plain actions, no request body,
// mirroring the job-action ".../reset" pattern. See run-control-semantics.md.
function runRoutes(repoPath: string, state: ServeState) {
  return new Hono()
    .post('/start', (c) => {
      if (state.isRunning()) return c.json({ error: 'a run is already in progress' }, 409);
      const settings = readSettings(repoPath);
      state.start(settings.defaultProvider, settings.defaultTimeoutMinutes * 60_000);
      return c.json({ started: true });
    })
    .post('/stop', (c) => {
      if (!state.isRunning()) return c.json({ error: 'no run is in progress' }, 409);
      state.requestStop();
      return c.json({ stopping: true });
    })
    .post('/cancel', (c) => {
      if (!state.isRunning()) return c.json({ error: 'no run is in progress' }, 409);
      state.requestCancel();
      return c.json({ cancelling: true });
    });
}

export { runRoutes };
