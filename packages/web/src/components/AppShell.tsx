import { History, ListChecks, Settings as SettingsIcon } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router';
import type { JobDisplayStatus, RunState } from 'contract';
import { useServeState } from '@/api/events';
import { useComposer } from '@/components/ComposerContext';
import { JobComposer } from '@/components/JobComposer';
import { buttonClass, cn } from '@/lib/utils';
import { formatDuration, useNow } from '@/lib/duration';
import { client } from '@/api/client';

const NAV = [
  { to: '/', label: 'Queue', icon: ListChecks },
  { to: '/history', label: 'History', icon: History },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

const DOT_CLASS: Record<JobDisplayStatus, string> = {
  PASS: 'bg-success',
  DONE: 'bg-success',
  RUNNING: 'bg-violet animate-pulse',
  BLOCKED: 'bg-danger',
  PENDING: 'bg-soft-foreground',
  'NOT RUN': 'bg-soft-foreground',
  SKIPPED: 'bg-soft-foreground',
};

// Time since this run started, frozen at its final value once it ends --
// ticks off run.startedAt the same way JobDetail's Heartbeat ticks off a
// job's, via the shared duration.ts helper.
function RunElapsed({ run }: { run: RunState }) {
  const isLive = run.status === 'in-progress';
  const now = useNow(isLive);
  const endMs = run.endedAt ? new Date(run.endedAt).getTime() : now;
  const elapsed = endMs - new Date(run.startedAt).getTime();

  return <span className="font-mono text-xs text-muted-foreground">{formatDuration(elapsed)} elapsed</span>;
}

// Persistent sidebar (brand tile + nav + "this run" status glance) beside a
// main content area -- the winning "App Shell" IA from
// cockpit-visual-design.md's round-1 grilling.
function AppShell() {
  const { queue, run, repo } = useServeState();
  const { request, openComposer, closeComposer } = useComposer();
  const location = useLocation();

  const isRunning = run?.status === 'in-progress';
  const title = NAV.find((item) => item.to === location.pathname)?.label ?? 'Queue';

  async function handleStart() {
    await client.api.run.start.$post();
  }
  async function handleStop() {
    await client.api.run.stop.$post();
  }
  async function handleCancel() {
    await client.api.run.cancel.$post();
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-[210px] flex-none flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-2 px-3.5 py-3.5 text-sm font-semibold">
          <span>overnight-runner</span>
          {repo ? (
            <span className="ml-auto truncate font-mono text-[11px] font-medium text-soft-foreground">
              {repo.name} / {repo.branch}
            </span>
          ) : null}
        </div>
        <nav className="flex flex-col gap-0.5 px-2.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
                  isActive && 'bg-muted font-semibold text-foreground'
                )
              }
            >
              <item.icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-2 flex-1 overflow-auto px-2.5 pb-2">
          <div className="px-1 py-2 text-[10.5px] font-semibold tracking-wide text-soft-foreground uppercase">This run</div>
          {queue.map((job) => (
            <div key={job.identity} className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs">
              <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[job.displayStatus])} />
              <span className="truncate">{job.identity}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] flex-none items-center gap-2.5 border-b border-border px-4">
          <h1 className="text-[15px] font-semibold">{title}</h1>
          {run && <RunElapsed run={run} />}
          <div className="flex-1" />
          <button className={buttonClass('outline', 'sm')} onClick={() => openComposer('create')}>
            + New job
          </button>
          {isRunning ? (
            <>
              <button className={buttonClass('outline', 'sm')} onClick={handleStop}>
                Stop
              </button>
              <button className={buttonClass('danger', 'sm')} onClick={handleCancel}>
                Cancel
              </button>
            </>
          ) : (
            <button className={buttonClass('primary', 'sm')} onClick={handleStart}>
              Start run
            </button>
          )}
        </header>
        <Outlet />
      </div>

      <JobComposer
        open={request !== null}
        onOpenChange={(open) => !open && closeComposer()}
        mode={request?.mode ?? 'create'}
        job={request?.job ?? null}
        queue={queue}
        onSaved={closeComposer}
      />
    </div>
  );
}

export { AppShell };
