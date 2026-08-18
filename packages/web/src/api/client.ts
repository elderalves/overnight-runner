import { createClient } from 'api-client';
import type { AppType } from 'overnight-runner/app-type';

// Same-origin in production (the backend serves this SPA); the dev proxy
// (vite.config.ts) forwards /api to the backend's own port during `npm run dev`.
const client = createClient<AppType>({ baseUrl: '' });

// A predictable git failure (409: "not a git repository", "unknown commit",
// invalid ref/name) or an unknown run/job (404) is an ANSWER, not an outage
// -- the Git views render it as an honest empty/not-found state rather than
// a generic error. `status` is what tells the two apart; see the Git query
// hooks in ./queries.ts.
class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function throwOnError(res: Response, fallback: string): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new ApiError(res.status, body?.error ?? fallback);
}

export { client, ApiError, throwOnError };
