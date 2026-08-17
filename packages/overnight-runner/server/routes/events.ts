import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ServeState } from '../runState.ts';

// The anti-buffering contract: Hono's own streamSSE header is a bare
// `no-cache`, which an intermediary (dev-mode Vite proxy, local security
// software) could still transform-buffer. Headers must be set on the
// returned Response, not via c.header(), because streamSSE's own helper
// overwrites Cache-Control set beforehand.
const streamSSENoBuffer: typeof streamSSE = (c, cb, onError) => {
  const res = streamSSE(c, cb, onError);
  res.headers.set('Cache-Control', 'no-cache, no-transform');
  res.headers.set('X-Accel-Buffering', 'no');
  return res;
};

// GET /api/events -- one SSE stream: `snapshot` once on connect, then every
// named lifecycle event live. Per api-endpoint-contract.md's "no server-
// pushed heartbeat," this does not loop-and-sleep sending pings -- it just
// blocks on an abort signal until the client disconnects.
function eventsRoutes(state: ServeState) {
  return new Hono().get('/', (c) => {
    return streamSSENoBuffer(c, async (stream) => {
      await stream.writeSSE({ event: 'snapshot', data: JSON.stringify(state.getSnapshot()) });

      const listener = (event: string, payload: unknown) => {
        void stream.writeSSE({ event, data: JSON.stringify(payload) });
      };
      state.subscribe(listener);

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          state.unsubscribe(listener);
          resolve();
        });
      });
    });
  });
}

export { eventsRoutes };
