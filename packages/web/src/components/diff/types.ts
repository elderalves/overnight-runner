import type { ChangedFile } from 'contract';

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
