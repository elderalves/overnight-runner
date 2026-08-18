import type { DiffFileChange } from './types';

/**
 * The image-diff predicate, ported from cezar's components/diff/image-
 * preview.tsx (frontend-git-component-port.md).
 *
 * `image` is set from the path's EXTENSION alone, so it is true for SVGs --
 * which git treats as text and diffs line by line with real +N/-M counts.
 * Previewing those as a lone picture would DESTROY the diff, so the note
 * below only wins when there is no text diff to lose: git called the file
 * binary, or there is no patch at all.
 *
 * Cezar's version renders an actual `<ZoomableImage>` behind a raw-bytes
 * route (`/files?raw=1`). This map has no Files tab and no raw-bytes route
 * (frontend-git-component-port.md), so an image file always gets the same
 * honest note every other binary gets -- there is nothing to fetch bytes
 * from.
 */
export function shouldPreviewImage(file: DiffFileChange): boolean {
  return file.image === true && (file.binary === true || file.patch === '');
}

export function ImagePreview({ file }: { file: DiffFileChange }) {
  if (file.status === 'deleted') {
    return <ImageNote>Image deleted.</ImageNote>;
  }
  return <ImageNote>Binary file — no text diff.</ImageNote>;
}

function ImageNote({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-2.5 text-xs text-soft-foreground">{children}</p>;
}
