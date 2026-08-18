import { FileDiffIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { ApiError } from '@/api/client';
import { useGitChanges } from '@/api/queries';
import { CenteredState } from '@/components/centered-state';
import { Diff, type DiffHandle, type DiffMode } from '@/components/diff';
import { AnimatedDiffStat } from '@/components/diff-stat';
import { ChangesTree } from '@/components/git/changes-tree';
import { DiffViewToggles } from '@/components/git/diff-controls';
import { buildFileTree } from '@/components/git/file-tree';
import { useIsDesktop } from '@/lib/use-desktop';

// The Git tab's Changes section: the target repo's uncommitted diff over
// GET /api/git/changes, ported from cezar's repo-git/repo-changes.tsx
// (frontend-git-component-port.md). Read-only -- no commit/push controls
// here (frontend-git-component-port.md's scope decision).
export function RepoChangesSection() {
  const changes = useGitChanges();
  const desktop = useIsDesktop();

  const [mode, setMode] = useState<DiffMode>('unified');
  const [wrap, setWrap] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const diffRef = useRef<DiffHandle | null>(null);

  // A 409 is the server's answer ("not a git repository"), not an outage.
  const refused = changes.isError && changes.error instanceof ApiError && changes.error.status === 409;

  const files = changes.data?.files ?? [];
  const tree = useMemo(() => buildFileTree(files), [files]);

  const effectiveMode: DiffMode = desktop ? mode : 'unified';
  const effectiveWrap = desktop ? wrap : true;

  const selectFile = (path: string) => {
    setSelected(path);
    diffRef.current?.scrollToPath(path);
  };

  return (
    <section data-slot="repo-changes" className="flex min-h-0 flex-1 flex-col">
      <div data-slot="repo-changes-toolbar" className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border px-4 py-2 md:px-6">
        <span className="text-xs text-muted-foreground">Uncommitted changes</span>
        {changes.data ? <AnimatedDiffStat stat={changes.data.stat} /> : null}
        <span className="ml-auto hidden items-center gap-1 md:flex">
          <DiffViewToggles mode={mode} wrap={wrap} onModeChange={setMode} onWrapChange={setWrap} />
        </span>
      </div>

      {changes.isPending ? (
        <p data-slot="changes-loading" className="px-4 py-6 text-center text-xs text-soft-foreground md:px-6">
          Loading changes…
        </p>
      ) : changes.isError ? (
        <CenteredState
          icon={refused ? <FileDiffIcon /> : <TriangleAlertIcon />}
          tone={refused ? 'neutral' : 'danger'}
          heading="h2"
          title={refused ? 'No changes to show' : 'Could not load the changes'}
          subtitle={changes.error.message}
        />
      ) : files.length === 0 ? (
        <CenteredState
          icon={<FileDiffIcon />}
          tone="neutral"
          heading="h2"
          title="Working tree clean"
          subtitle="No uncommitted changes in the target repo. Edits show up here as they happen."
        />
      ) : (
        <div className="flex min-h-0 flex-1 items-start gap-5 px-4 py-4 [--diff-sticky-top:7rem] md:px-6">
          <aside className="sticky top-28 hidden w-60 shrink-0 md:block lg:w-72">
            <ChangesTree root={tree} selected={selected} onSelect={selectFile} />
          </aside>
          <Diff files={files} viewRef={diffRef} mode={effectiveMode} wrap={effectiveWrap} className="min-w-0 flex-1" />
        </div>
      )}
    </section>
  );
}
