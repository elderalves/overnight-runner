import { createServer } from 'node:net';

// First free port starting at `start`, scanning up to 50 ports upward if
// busy -- cheap insurance against a collision if `serve` is ever run against
// two different repos at once, rather than a hard failure on a busy port.
async function pickPort(start: number): Promise<number> {
  for (let port = start; port < start + 50; port++) {
    if (await canListen(port)) return port;
  }
  return start; // let the server fail loudly if 50 ports are somehow busy
}

function canListen(port: number): Promise<boolean> {
  return new Promise((resolvePort) => {
    const probe = createServer();
    probe.once('error', () => resolvePort(false));
    probe.once('listening', () => probe.close(() => resolvePort(true)));
    probe.listen(port, '127.0.0.1');
  });
}

export { pickPort };
