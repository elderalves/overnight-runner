import type { createApp } from './app.ts';

// The one input packages/api-client's hc<AppType>() needs -- import type
// only, so it drags in none of the server's runtime code across the
// browser/backend boundary.
export type AppType = ReturnType<typeof createApp>;
