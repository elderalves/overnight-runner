import { CheckIcon, GitBranchIcon, PlusIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { GitResponse } from 'contract';

import { useCreateOrSwitchBranch, useSaveSettings, useSettings } from '@/api/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * The Git tab's Branches section, ported from cezar's repo-git/repo-
 * branches.tsx (frontend-git-component-port.md): the branch list GET
 * /api/git already carries, with switch/create wired to
 * POST /api/git/branch, and the Configured base branch picker wired to
 * PUT /api/settings (base-branch-configurability.md) rather than cezar's own
 * dedicated /api/config route.
 *
 * The forge-only block cezar renders here (open pull requests, gated on
 * /api/health) is dropped outright, per the research inventory and this
 * map's out-of-scope GitHub issues/PRs decision -- there is no equivalent
 * surface, not a trimmed one.
 */
export function RepoBranchesSection({ git }: { git: GitResponse }) {
  const info = git.info!;
  const branchAction = useCreateOrSwitchBranch();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const [newName, setNewName] = useState('');
  const [branchQuery, setBranchQuery] = useState('');
  const normalizedBranchQuery = branchQuery.trim().toLowerCase();
  const filteredBranches = normalizedBranchQuery ? git.branches.filter((name) => name.toLowerCase().includes(normalizedBranchQuery)) : git.branches;

  const switchTo = (name: string) => {
    setMessage(null);
    branchAction.mutate(
      { name },
      {
        onSuccess: (result) => setMessage({ tone: 'success', text: result.created ? `Created and switched to ${result.branch}` : `Switched to ${result.branch}` }),
        onError: (error) => setMessage({ tone: 'danger', text: error.message }),
      }
    );
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setMessage(null);
    branchAction.mutate(
      { name },
      {
        onSuccess: (result) => {
          setNewName('');
          setMessage({ tone: 'success', text: result.created ? `Created and switched to ${result.branch}` : `Switched to ${result.branch}` });
        },
        onError: (error) => setMessage({ tone: 'danger', text: error.message }),
      }
    );
  };

  const setBaseBranch = (value: string) => {
    if (!settings.data) return;
    setMessage(null);
    saveSettings.mutate(
      { ...settings.data, baseBranch: value === '' ? null : value },
      {
        onSuccess: (saved) =>
          setMessage({
            tone: 'success',
            text: saved.baseBranch ? `Future worktree jobs now fork from ${saved.baseBranch}` : 'Future worktree jobs now fork from the checked-out branch',
          }),
        onError: (error) => setMessage({ tone: 'danger', text: (error as Error).message }),
      }
    );
  };

  return (
    <section data-slot="repo-branches" className="flex flex-col gap-6 px-4 py-4 md:px-6">
      <div>
        <h2 className="text-xs font-semibold tracking-wide text-soft-foreground uppercase">Branches</h2>
        <Input aria-label="Filter branches" placeholder="Filter branches…" value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} className="mt-2 max-w-xl" />
        <ul data-slot="repo-branch-list" className="mt-2 flex max-w-xl flex-col divide-y divide-border">
          {filteredBranches.map((name) => {
            const current = name === info.branch;
            return (
              <li key={name} data-slot="branch-row" data-branch={name} className="flex min-h-9 items-center gap-2 py-1">
                <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className={cn('min-w-0 truncate font-mono text-xs', current && 'font-semibold')}>{name}</span>
                {current ? (
                  <span data-slot="branch-current" className="flex shrink-0 items-center gap-1 rounded-sm bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                    <CheckIcon aria-hidden="true" className="size-3" />
                    current
                  </span>
                ) : (
                  <Button variant="ghost" size="sm" data-action="switch-branch" className="ml-auto" disabled={branchAction.isPending} onClick={() => switchTo(name)}>
                    Switch
                  </Button>
                )}
              </li>
            );
          })}
          {filteredBranches.length === 0 ? (
            <li data-slot="branch-empty" className="py-3 text-xs text-soft-foreground">
              No branches match “{branchQuery.trim()}”.
            </li>
          ) : null}
        </ul>

        <form data-slot="branch-create" className="mt-3 flex max-w-md items-center gap-2" onSubmit={submitCreate}>
          <Input aria-label="New branch name" placeholder="new-branch-name" value={newName} onChange={(event) => setNewName(event.target.value)} />
          <Button type="submit" variant="outline" size="sm" data-action="create-branch" disabled={!newName.trim() || branchAction.isPending}>
            <PlusIcon aria-hidden="true" />
            Create
          </Button>
        </form>
      </div>

      <div className="max-w-md">
        <label htmlFor="base-branch-picker" className="text-xs font-semibold tracking-wide text-soft-foreground uppercase">
          Configured base branch
        </label>
        {/* A native <select>: a handful of branch names needs no popover machinery. */}
        <select
          id="base-branch-picker"
          data-slot="base-branch-picker"
          value={git.baseBranch ?? ''}
          disabled={saveSettings.isPending || !settings.data}
          onChange={(event) => setBaseBranch(event.target.value)}
          className="mt-1.5 block w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <option value="">follow checked-out branch (default)</option>
          {git.branches.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] text-soft-foreground">Future worktree jobs fork from this; Git views compare against it. inline jobs are unaffected.</p>
      </div>

      {message ? <p className={cn('text-xs', message.tone === 'success' ? 'text-success' : 'text-danger')}>{message.text}</p> : null}
    </section>
  );
}
