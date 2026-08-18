import type { ChangedFile } from 'contract';

/**
 * The <Diff> facade contract, ported from cezar's components/diff/types.ts
 * (frontend-git-component-port.md). Consumers (the Git tab's Changes/Commits
 * sections, per-job Changes/Commits) import from @/components/diff and never
 * from a diff-rendering library directly.
 *
 * Trimmed from cezar's version: no `loadFileText` (expandable context) and no
 * `imageSrc`/`onOpenInApp` (image preview, "open in app") props -- both need
 * a raw-bytes route into the worktree, and this map's Files tab / per-job
 * commit-push actions are explicitly out of scope (frontend-git-component-
 * port.md). Context gaps render as static "N unchanged lines" separators
 * instead of expanding, and image files always show the honest binary note.
 */
export type DiffFileChange = ChangedFile;

export type DiffMode = 'unified' | 'split';

/**
 * The imperative seam for "reveal this file" (the file tree). Past
 * diff-scroll.ts's threshold an off-screen file has no element to
 * scrollIntoView, so the scroll goes through the virtualizer's index instead.
 */
export interface DiffHandle {
  /** Scroll the file at `path` to the top of the scroll container. A no-op if it isn't in `files`. */
  scrollToPath: (path: string) => void;
}

export interface DiffProps {
  files: DiffFileChange[];
  /** Layout: one interleaved column, or old|new side by side. Default `unified`. */
  mode?: DiffMode;
  /** Soft-wrap long lines instead of horizontal scrolling. Default `false`. */
  wrap?: boolean;
  /** Receives the {@link DiffHandle}. A plain ref-shaped prop, not the component's own `ref`. */
  viewRef?: { current: DiffHandle | null };
  className?: string;
}
