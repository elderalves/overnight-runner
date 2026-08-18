import type { DiffFileChange } from './types';

/**
 * THE PERFORMANCE RULE: up to {@link DIFF_VIRTUALIZE_THRESHOLD} rendered rows
 * the diff renders every file card flat, each carrying
 * `content-visibility: auto` -- the browser skips style/layout/paint for
 * off-screen cards with zero behavior risk. Past the threshold the same
 * cards go through virtua's <Virtualizer>, which bounds the DOM itself.
 */

/** Rendered rows across all files, past which the file list goes through virtua. */
export const DIFF_VIRTUALIZE_THRESHOLD = 1500;

/** One diff row's height at text-xs/leading-[1.7] (12px x 1.7 ~ 20.4px), rounded down. */
export const DIFF_ROW_ESTIMATE_PX = 20;

/** The card chrome above/below a body (sticky header + padding), for the same estimate. */
const DIFF_CARD_CHROME_PX = 44;

/**
 * How many rows a file will render, WITHOUT parsing it: the patch's line
 * count, minus the `diff --git`/`---`/`+++` preamble git puts before the
 * first `@@`. An over-estimate on files whose patch carries extra metadata
 * lines, which is the safe direction.
 */
export function estimateFileRows(file: DiffFileChange): number {
  if (file.binary === true || file.patch === '') return 1; // the one-line "no text diff" note
  const lines = file.patch.split('\n');
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  return firstHunk === -1 ? lines.length : lines.length - firstHunk;
}

/** A card's placeholder height for contain-intrinsic-block-size / virtua's estimate. */
export function estimateFileHeight(file: DiffFileChange): number {
  return estimateFileRows(file) * DIFF_ROW_ESTIMATE_PX + DIFF_CARD_CHROME_PX;
}

/** Total rendered rows across the changeset -- the number the threshold rule is about. */
export function diffRowCount(files: readonly DiffFileChange[]): number {
  return files.reduce((sum, file) => sum + estimateFileRows(file), 0);
}

/**
 * Which renderer the diff uses. `search` is the location's query string:
 * `?diff=flat` and `?diff=virtual` force a mode -- a measurement/debugging
 * escape hatch; anything else is `auto`, the threshold rule above.
 */
export function diffRenderMode(search: string, rowCount: number): 'flat' | 'virtual' {
  const forced = new URLSearchParams(search).get('diff');
  if (forced === 'flat' || forced === 'virtual') return forced;
  return rowCount > DIFF_VIRTUALIZE_THRESHOLD ? 'virtual' : 'flat';
}

/** Stable identity for a file across refetches -- the renderer's key and its state map's key. */
export function fileKey(file: DiffFileChange): string {
  return `${file.oldPath ?? ''}→${file.path}`;
}

/**
 * The widest line in a patch, in characters. In no-wrap mode the card body
 * scrolls horizontally, and content-visibility size-contains off-screen rows
 * -- so without a floor the body's scrollWidth would be whatever the
 * CURRENTLY VISIBLE rows happen to be. The body pins a min-inline-size of
 * this many `ch` instead.
 */
export function widestLineChars(patch: string): number {
  let widest = 0;
  for (const line of patch.split('\n')) if (line.length > widest) widest = line.length;
  return widest;
}
