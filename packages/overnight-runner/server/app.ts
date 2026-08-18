import { Hono } from 'hono';
import { jobsRoutes } from './routes/jobs.ts';
import { runRoutes } from './routes/run.ts';
import { eventsRoutes } from './routes/events.ts';
import { historyRoutes } from './routes/history.ts';
import { settingsRoutes } from './routes/settings.ts';
import { gitRoutes } from './routes/git.ts';
import { ServeState } from './runState.ts';
import { createStaticUi } from './staticUi.ts';

// The return type is INFERRED on purpose -- it's the chained app type built
// at the bottom of this function, and AppType (server/appType.ts) is
// ReturnType<typeof createApp>. Annotating it `Hono` here would erase every
// route from the type Hono's `hc<AppType>()` client needs.
// See server-architecture.md's "Route structure".
function createApp(repoPath: string) {
  const state = new ServeState(repoPath);
  const staticUi = createStaticUi();

  const api = new Hono()
    .route('/jobs', jobsRoutes(repoPath, state))
    .route('/run', runRoutes(repoPath, state))
    .route('/events', eventsRoutes(state))
    .route('/runs', historyRoutes(repoPath))
    .route('/settings', settingsRoutes(repoPath))
    .route('/git', gitRoutes(repoPath));

  // Static assets + SPA catch-all, mounted last -- hand-rolled, not Hono's
  // serveStatic, per server-architecture.md's "Static-asset serving".
  return new Hono()
    .route('/api', api)
    .get('/assets/:file', (c) => staticUi.serveAsset(c.req.param('file')))
    .get('*', () => staticUi.serveIndex());
}

export { createApp };
