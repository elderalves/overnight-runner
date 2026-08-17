import { createClient } from 'api-client';
import type { AppType } from 'overnight-runner/app-type';

// Same-origin in production (the backend serves this SPA); the dev proxy
// (vite.config.ts) forwards /api to the backend's own port during `npm run dev`.
const client = createClient<AppType>({ baseUrl: '' });

export { client };
