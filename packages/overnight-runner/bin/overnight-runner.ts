#!/usr/bin/env node
import path from 'node:path';
import * as runner from '../lib/runner.ts';
import { ADAPTERS, DEFAULT_TIMEOUT_MS } from '../lib/providers.ts';
import { migrate } from '../lib/migrate.ts';

function printHelp(): void {
  console.log(`overnight-runner [repo-path] [options]

Runs the .overnight-runner/jobs/*.md queue in the target repo, one fresh agent session per job
(via the "implement-overnight" skill), checkpointed with git commits.

Arguments:
  repo-path              Target repo to run against. Defaults to the current directory.

Options:
  --provider <name>      Default provider when a job has no provider frontmatter.
                         One of: ${Object.keys(ADAPTERS).join(', ')}. Defaults to "claude".
  --timeout <minutes>    Per-job timeout, in minutes. Defaults to ${DEFAULT_TIMEOUT_MS / 60000}.
  -h, --help             Show this help.

A job's own \`provider\` frontmatter field always wins over --provider.
See CONTEXT.md and .alves/issues/ in this repo for the full design.

Subcommands:
  serve [repo-path] [--port <n>]   Boot the browser control-plane interface.`);
}

const DEFAULT_SERVE_PORT = 4321;

function printServeHelp(): void {
  console.log(`overnight-runner serve [repo-path] [options]

Boots a localhost-only web control plane fronting the same queue engine --
watch the queue live, start/stop/cancel a run, author/edit jobs, and browse
history and settings, all from the browser. No auth, no remote access --
binds to 127.0.0.1 only.

Arguments:
  repo-path              Target repo to serve. Defaults to the current directory.

Options:
  --port <n>             Preferred port to bind. Defaults to ${DEFAULT_SERVE_PORT} (scans upward if busy).
  -h, --help             Show this help.`);
}

interface ServeArgs {
  repo: string;
  port: number;
  help?: boolean;
}

function parseServeArgs(argv: string[]): ServeArgs {
  const args: ServeArgs = { repo: process.cwd(), port: DEFAULT_SERVE_PORT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--port') {
      args.port = Number(argv[++i]);
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (!a.startsWith('--')) {
      args.repo = a;
    } else {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

// Dynamically imported so the plain one-shot CLI path never pulls in Hono/
// @hono-node-server -- `serve` mode is additive, per this map's Boundary note.
async function runServe(argv: string[]): Promise<void> {
  const args = parseServeArgs(argv);
  if (args.help) {
    printServeHelp();
    return;
  }
  if (!Number.isFinite(args.port) || args.port <= 0) {
    console.error('Invalid --port: must be a positive number');
    process.exit(1);
  }

  const [{ createApp }, { pickPort }, { serve }] = await Promise.all([
    import('../server/app.ts'),
    import('../server/pickPort.ts'),
    import('@hono/node-server'),
  ]);

  const repoPath = path.resolve(args.repo);
  const app = createApp(repoPath);
  const port = await pickPort(args.port);
  if (port !== args.port) {
    console.log(`overnight-runner: port ${args.port} was busy -- using ${port}`);
  }

  serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
    console.log(`overnight-runner serve: http://127.0.0.1:${port} (repo: ${repoPath})`);
  });
}

interface Args {
  repo: string;
  provider: string | undefined;
  timeoutMinutes: number;
  help?: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { repo: process.cwd(), provider: 'claude', timeoutMinutes: DEFAULT_TIMEOUT_MS / 60000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--provider') {
      args.provider = argv[++i];
    } else if (a === '--timeout') {
      args.timeoutMinutes = Number(argv[++i]);
    } else if (a === '-h' || a === '--help') {
      args.help = true;
    } else if (!a.startsWith('--')) {
      args.repo = a;
    } else {
      console.error(`Unknown option: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  if (sub === 'serve') {
    await runServe(rest);
    return;
  }

  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const providerAdapter = args.provider === undefined ? undefined : ADAPTERS[args.provider];
  if (!providerAdapter) {
    console.error(`Unknown provider "${args.provider}" (known: ${Object.keys(ADAPTERS).join(', ')})`);
    process.exit(1);
  }
  if (!Number.isFinite(args.timeoutMinutes) || args.timeoutMinutes <= 0) {
    console.error(`Invalid --timeout: must be a positive number of minutes`);
    process.exit(1);
  }

  const repoPath = path.resolve(args.repo);
  migrate(repoPath);
  const summaryPath = await runner.run(repoPath, {
    defaultProvider: args.provider,
    timeoutMs: args.timeoutMinutes * 60000,
  });
  console.log(`Run summary: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
