#!/usr/bin/env node
import path from 'node:path';
import * as runner from '../lib/runner.ts';
import { ADAPTERS, DEFAULT_TIMEOUT_MS } from '../lib/providers.ts';

function printHelp(): void {
  console.log(`overnight-runner [repo-path] [options]

Runs the jobs/*.md queue in the target repo, one fresh agent session per job
(via the "implement-overnight" skill), checkpointed with git commits.

Arguments:
  repo-path              Target repo to run against. Defaults to the current directory.

Options:
  --provider <name>      Default provider when a job has no provider frontmatter.
                         One of: ${Object.keys(ADAPTERS).join(', ')}. Defaults to "claude".
  --timeout <minutes>    Per-job timeout, in minutes. Defaults to ${DEFAULT_TIMEOUT_MS / 60000}.
  -h, --help             Show this help.

A job's own \`provider\` frontmatter field always wins over --provider.
See CONTEXT.md and .alves/issues/ in this repo for the full design.`);
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
