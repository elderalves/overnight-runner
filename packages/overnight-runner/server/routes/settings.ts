import { Hono } from 'hono';
import { validator } from 'hono/validator';
import type { Settings } from 'contract';
import { readSettings, writeSettings } from '../../lib/settings.ts';

// GET/PUT /api/settings -- persisted to a gitignored JSON file under the
// target repo's .overnight-runner/ directory. See api-endpoint-contract.md's
// "Settings".
function settingsRoutes(repoPath: string) {
  return new Hono()
    .get('/', (c) => c.json(readSettings(repoPath)))
    .put(
      '/',
      validator('json', (value) => value as Settings),
      (c) => {
        const settings = c.req.valid('json');
        writeSettings(repoPath, settings);
        return c.json(settings);
      }
    );
}

export { settingsRoutes };
