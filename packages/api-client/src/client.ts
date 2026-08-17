import { hc } from 'hono/client';
import type { Hono } from 'hono';

export interface ClientOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
}

// Mirrors cezar's createCezarClient -- minus the auth-token option, since
// this map ruled out authentication entirely (localhost-only, no auth). `T`
// is meant to be instantiated with `AppType`, imported type-only from
// `overnight-runner/app-type` -- see frontend-stack.md.
function createClient<T extends Hono<any, any, any> = Hono>(options: ClientOptions = {}): ReturnType<typeof hc<T>> {
  const { baseUrl = '', headers } = options;
  return hc<T>(baseUrl, { headers });
}

export { createClient };
