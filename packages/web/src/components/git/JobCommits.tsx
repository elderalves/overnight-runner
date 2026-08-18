import { ArrowLeftIcon, GitCommitHorizontalIcon, SearchXIcon, TriangleAlertIcon } from 'lucide-react';
import { useState } from 'react';

import { ApiError } from '@/api/client';
import { useJobCommit, useJobCommits } from '@/api/queries';
import { CenteredState } from '@/components/centered-state';
import { Diff, type DiffMode } from '@/components/diff';
import { DiffStatLabel } from '@/components/diff-stat';
import { Button } from '@/components/ui/button';
import { useIsDesktop } from '@/lib/use-desktop';
import { CommitList } from './commit-list';
import { DiffViewToggles } from './diff-controls';

/**
 * Job Detail's Commits tab, ported from cezar's task-git/task-commits.tsx
 * (frontend-git-component-port.md): this job's own commits
 * (jobStartRef..jobEndRef), each opening its structured diff through the
 * same <Diff> facade. Not its own route (Job Detail is embedded in Queue's
 * pinned pane and History's nested disclosure, not a page) -- drills into a
 * commit via local state instead of a URL.
 */
export function JobCommits({ runId, identity, live }: { runId: string | null; identity: string; live: boolean }) {
  const commits = useJobCommits(runId, identity, live);
  const [sha, setSha] = useState<string | null>(null);

  if (runId === null) {
    return <CenteredState icon={<GitCommitHorizontalIcon />} tone="neutral" heading="h2" title="No commits yet" subtitle="This job hasn't produced a diff yet." />;
  }
  if (sha) return <JobCommitDiff runId={runId} identity={identity} sha={sha} onBack={() => setSha(null)} />;

  if (commits.isPending) {
    return (
      <p data-slot="job-commits-loading" className="px-1 py-4 text-center text-xs text-soft-foreground">
        Loading commits…
      </p>
    );
  }
  if (commits.isError) {
    const refused = commits.error instanceof ApiError && commits.error.status === 409;
    return (
      <CenteredState
        icon={refused ? <GitCommitHorizontalIcon /> : <TriangleAlertIcon />}
        tone={refused ? 'neutral' : 'danger'}
        heading="h2"
        title={refused ? 'No commits yet' : 'Could not load the commits'}
        subtitle={commits.error.message}
      />
    );
  }
  if (commits.data.commits.length === 0) {
    return <CenteredState icon={<GitCommitHorizontalIcon />} tone="neutral" heading="h2" title="No commits yet" subtitle="This job hasn't committed anything yet." />;
  }
  return (
    <CommitList
      slot="job-commits"
      commits={commits.data.commits.map((commit) => ({ ...commit, shaLabel: commit.sha.slice(0, 8) }))}
      onSelect={setSha}
    />
  );
}

function JobCommitDiff({ runId, identity, sha, onBack }: { runId: string; identity: string; sha: string; onBack: () => void }) {
  const commit = useJobCommit(runId, identity, sha);
  const desktop = useIsDesktop();
  const [mode, setMode] = useState<DiffMode>('unified');
  const [wrap, setWrap] = useState(false);

  const refused = commit.isError && commit.error instanceof ApiError && commit.error.status === 409;
  const effectiveMode: DiffMode = desktop ? mode : 'unified';
  const effectiveWrap = desktop ? wrap : true;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <Button variant="ghost" size="sm" data-slot="commit-back" onClick={onBack}>
          <ArrowLeftIcon aria-hidden="true" />
          All commits
        </Button>
        {commit.data ? <DiffStatLabel stat={commit.data.stat} /> : null}
        <span className="ml-auto hidden items-center gap-1 md:flex">
          <DiffViewToggles mode={mode} wrap={wrap} onModeChange={setMode} onWrapChange={setWrap} />
        </span>
      </div>

      {commit.isPending ? (
        <p className="px-1 py-4 text-center text-xs text-soft-foreground">Loading commit…</p>
      ) : commit.isError ? (
        <CenteredState
          icon={refused ? <SearchXIcon /> : <TriangleAlertIcon />}
          tone={refused ? 'neutral' : 'danger'}
          heading="h2"
          title={refused ? 'Commit not found' : 'Could not load the commit'}
          subtitle={commit.error.message}
        />
      ) : (
        <>
          <div>
            <h2 className="text-sm font-semibold">{commit.data.subject}</h2>
            <p className="mt-0.5 text-[11px] text-soft-foreground">
              {commit.data.author} · {commit.data.when} · <span className="font-mono select-all">{commit.data.sha}</span>
            </p>
          </div>
          {commit.data.files.length === 0 ? (
            <CenteredState icon={<GitCommitHorizontalIcon />} tone="neutral" heading="h2" title="No file changes" subtitle="This commit carries no diff of its own." />
          ) : (
            <Diff files={commit.data.files} mode={effectiveMode} wrap={effectiveWrap} className="min-w-0" />
          )}
        </>
      )}
    </div>
  );
}
