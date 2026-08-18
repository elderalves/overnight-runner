import type { DiffFileChange } from './types';

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
