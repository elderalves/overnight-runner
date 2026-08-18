import { LoaderCircleIcon } from 'lucide-react';

import { CenteredState } from '@/components/centered-state';

// The Git tab's loading surface, ported from cezar's repo-git/repo-git-
// loading.tsx (frontend-git-component-port.md).
export function RepoGitLoading() {
  return (
    <div data-route="repo-git" className="flex min-h-full flex-col">
      <CenteredState icon={<LoaderCircleIcon className="motion-safe:animate-spin" />} tone="neutral" title="Loading repository…" subtitle="Fetching the repo's git state." />
    </div>
  );
}
