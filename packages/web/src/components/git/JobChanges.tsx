import { FileDiffIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { ApiError } from '@/api/client';
import { useJobChanges } from '@/api/queries';
import { CenteredState } from '@/components/centered-state';
import { Diff, type DiffHandle, type DiffMode } from '@/components/diff';
import { AnimatedDiffStat } from '@/components/diff-stat';
import { useIsDesktop } from '@/lib/use-desktop';
import { ChangesTree } from './changes-tree';
import { DiffViewToggles } from './diff-controls';
import { buildFileTree } from './file-tree';

/**
 * Job Detail's Changes tab, ported from cezar's task-git/task-changes.tsx
 * (frontend-git-component-port.md) and trimmed to a read-only historical
 * surface: no toolbar, no commit/push/PR actions, no Files tab -- a job's
 * worktree may already be torn down by the time this renders.
 *
 * `runId === null` means this job hasn't been touched by any run this server
 * session has seen (idle queue listing) -- the empty state renders without
 * ever fetching. Once a run id is known, a missing jobStartRef..jobEndRef
 * range still renders the same empty state (the route's own successful-empty
 * response), so the tab layout never changes shape across a job's lifecycle
 * -- see git-feature-ia-placement.md.
 */
export function JobChanges({ runId, identity, live }: { runId: string | null; identity: string; live: boolean }) {
  const changes = useJobChanges(runId, identity, live);
  const desktop = useIsDesktop();

  const [mode, setMode] = useState<DiffMode>('unified');
  const [wrap, setWrap] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const diffRef = useRef<DiffHandle | null>(null);

  const refused = changes.isError && changes.error instanceof ApiError && changes.error.status === 409;
  const files = changes.data?.files ?? [];
  const tree = useMemo(() => buildFileTree(files), [files]);
  const effectiveMode: DiffMode = desktop ? mode : 'unified';
  const effectiveWrap = desktop ? wrap : true;

  const selectFile = (path: string) => {
    setSelected(path);
    diffRef.current?.scrollToPath(path);
  };

  if (runId === null) {
    return <CenteredState icon={<FileDiffIcon />} tone="neutral" heading="h2" title="No changes yet" subtitle="This job hasn't produced a diff yet." />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {changes.data && files.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <AnimatedDiffStat stat={changes.data.stat} />
          <span className="ml-auto hidden items-center gap-1 md:flex">
            <DiffViewToggles mode={mode} wrap={wrap} onModeChange={setMode} onWrapChange={setWrap} />
          </span>
        </div>
      ) : null}

      {changes.isPending ? (
        <p data-slot="job-changes-loading" className="px-1 py-4 text-center text-xs text-soft-foreground">
          Loading changes…
        </p>
      ) : changes.isError ? (
        <CenteredState
          icon={refused ? <FileDiffIcon /> : <TriangleAlertIcon />}
          tone={refused ? 'neutral' : 'danger'}
          heading="h2"
          title={refused ? 'No changes yet' : 'Could not load the changes'}
          subtitle={changes.error.message}
        />
      ) : files.length === 0 ? (
        <CenteredState icon={<FileDiffIcon />} tone="neutral" heading="h2" title="No changes yet" subtitle="This job hasn't committed anything yet." />
      ) : (
        <div className="flex min-h-0 flex-1 items-start gap-4">
          <aside className="hidden w-44 shrink-0 lg:block">
            <ChangesTree root={tree} selected={selected} onSelect={selectFile} />
          </aside>
          <Diff files={files} viewRef={diffRef} mode={effectiveMode} wrap={effectiveWrap} className="min-w-0 flex-1" />
        </div>
      )}
    </div>
  );
}
