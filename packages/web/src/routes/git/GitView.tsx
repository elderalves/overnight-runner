import { GitBranchIcon, TriangleAlertIcon } from 'lucide-react';
import type { GitResponse } from 'contract';

import { useGit } from '@/api/queries';
import { CenteredState } from '@/components/centered-state';
import { TabLink } from '@/components/tab-link';
import { BranchChip } from '@/components/git/diff-controls';
import { RepoGitLoading } from './RepoGitLoading';
import { RepoChangesSection } from './RepoChangesSection';
import { RepoCommitsSection } from './RepoCommitsSection';
import { RepoBranchesSection } from './RepoBranchesSection';

/**
 * The repo-level Git tab, ported from cezar's repo-git/repo-git.tsx
 * (frontend-git-component-port.md): the target repo's structured diff, the
 * recent-commit log with per-commit diffs, and the branch list with switch/
 * create + the Configured base branch picker. URL-backed sections (`/git`,
 * `/git/commits[/:sha]`, `/git/branches`), so every surface deep-links and
 * survives a refresh -- see git-feature-ia-placement.md.
 */
export type RepoTab = 'changes' | 'commits' | 'branches';

export function GitView({ tab }: { tab: RepoTab }) {
  const git = useGit();

  if (git.isPending) return <RepoGitLoading />;
  if (git.isError) {
    return (
      <div data-route="repo-git" className="flex min-h-full flex-col">
        <CenteredState icon={<TriangleAlertIcon />} tone="danger" title="Could not load the repository" subtitle={git.error.message} />
      </div>
    );
  }
  if (!git.data.info) {
    return (
      <div data-route="repo-git" className="flex min-h-full flex-col">
        <CenteredState
          icon={<GitBranchIcon />}
          tone="neutral"
          title="Not a git repository"
          subtitle="overnight-runner is running outside a git repository — point it at one to browse changes, commits and branches."
        />
      </div>
    );
  }
  return <GitTabContent git={git.data} tab={tab} />;
}

function GitTabContent({ git, tab }: { git: GitResponse; tab: RepoTab }) {
  const info = git.info!;
  return (
    <div data-route="repo-git" data-slot="main" className="flex min-h-0 flex-1 flex-col overflow-auto">
      <header data-slot="repo-header" className="sticky top-0 z-20 border-b border-border bg-background/95 px-4 pt-3 backdrop-blur md:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="text-lg font-semibold">Git</h1>
          <BranchChip branch={info.branch} />
          {info.remote ? (
            <span data-slot="repo-remote" className="hidden min-w-0 truncate text-[11px] text-soft-foreground md:inline">
              {info.remote}
            </span>
          ) : null}
        </div>

        <div data-slot="repo-tabs" className="mt-2.5 flex items-end gap-1">
          <TabLink to="/git" active={tab === 'changes'}>
            Changes
          </TabLink>
          <TabLink to="/git/commits" active={tab === 'commits'}>
            Commits
          </TabLink>
          <TabLink to="/git/branches" active={tab === 'branches'}>
            Branches
          </TabLink>
        </div>
      </header>

      {tab === 'changes' ? <RepoChangesSection /> : tab === 'commits' ? <RepoCommitsSection log={git.log} /> : <RepoBranchesSection git={git} />}
    </div>
  );
}
