import { useEffect, useImperativeHandle, useRef, useState, type ComponentType } from 'react';

import type { DiffStat } from 'contract';
import { DiffStatLabel } from '@/components/diff-stat';
import { cn } from '@/lib/utils';

import { ImagePreview, shouldPreviewImage } from './image-preview';
import type { DiffFileChange, DiffProps } from './types';

/**
 * <Diff> -- the ONE diff surface of the Git tab and per-job Git view, ported
 * from cezar's components/diff/diff.tsx (frontend-git-component-port.md).
 * Props are ours (./types.ts); consumers never import a diff library.
 *
 * The renderer loads as a lazy chunk (parser + word-diff + Shiki wiring stay
 * off the main bundle). If that chunk fails to load, the inline
 * `DiffFallback` below renders the same props as plain marked-up patch text:
 * degraded, never blank.
 */
export function Diff(props: DiffProps) {
  const [engine, setEngine] = useState<{ View: ComponentType<DiffProps> } | 'failed' | null>(null);
  useEffect(() => {
    let cancelled = false;
    import('./diff-view').then(
      (module) => {
        if (!cancelled) setEngine({ View: module.DiffView });
      },
      () => {
        if (!cancelled) setEngine('failed');
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // The empty state needs no engine -- render it synchronously, chunk or no chunk.
  if (props.files.length === 0) {
    return (
      <p data-slot="diff-empty" className={cn('px-1 text-xs text-soft-foreground', props.className)}>
        No changes.
      </p>
    );
  }
  if (engine === 'failed') return <DiffFallback {...props} />;
  if (engine === null) {
    return (
      <p data-slot="diff-loading" className={cn('px-1 text-xs text-soft-foreground', props.className)}>
        Loading diff…
      </p>
    );
  }
  return <engine.View {...props} />;
}

/**
 * The zero-dependency fallback: same props, raw patch text with +/- line
 * tints from the theme tokens. No parser, no highlighter, no lazy import.
 * Split mode degrades to unified; that is documented degradation, not a bug.
 */
export function DiffFallback({ files, wrap = false, viewRef, className }: DiffProps) {
  const stat: DiffStat = {
    adds: files.reduce((sum, file) => sum + file.adds, 0),
    dels: files.reduce((sum, file) => sum + file.dels, 0),
    files: files.length,
  };
  // The fallback never virtualizes, so every file IS in the DOM -- the handle
  // a consumer's file tree calls resolves straight to the element.
  const root = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(viewRef, () => ({
    scrollToPath: (path: string) => {
      for (const element of root.current?.querySelectorAll<HTMLElement>('[data-slot="diff-file"]') ?? []) {
        if (element.dataset.path === path) {
          element.scrollIntoView({ block: 'start', behavior: 'smooth' });
          return;
        }
      }
    },
  }));
  return (
    <div ref={root} data-slot="diff" data-fallback="true" className={cn('flex min-w-0 flex-col gap-3', className)}>
      <p data-slot="diff-totals" className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <span>
          {stat.files} {stat.files === 1 ? 'file' : 'files'} changed
        </span>
        <DiffStatLabel stat={stat} />
      </p>
      {files.map((file) => (
        <FallbackFile key={`${file.oldPath ?? ''}→${file.path}`} file={file} wrap={wrap} />
      ))}
    </div>
  );
}

function FallbackFile({ file, wrap }: { file: DiffFileChange; wrap: boolean }) {
  return (
    <section data-slot="diff-file" data-path={file.path} className="min-w-0 overflow-clip rounded-md border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span data-slot="diff-file-path" className="min-w-0 truncate font-mono text-xs font-medium">
          {file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        </span>
        <span className="ml-auto shrink-0">
          <DiffStatLabel stat={{ adds: file.adds, dels: file.dels, files: 1 }} className="text-[11px]" />
        </span>
      </header>
      {shouldPreviewImage(file) ? (
        <ImagePreview file={file} />
      ) : file.binary ? (
        <p className="px-4 py-2.5 text-xs text-soft-foreground">Binary file — no text diff.</p>
      ) : file.patch === '' ? (
        <p className="px-4 py-2.5 text-xs text-soft-foreground">No content changes (metadata only).</p>
      ) : (
        <pre className={cn('py-2 font-mono text-xs leading-[1.7]', wrap ? 'break-words whitespace-pre-wrap' : 'overflow-x-auto whitespace-pre')}>
          {file.patch.split('\n').map((line, index) => (
            <span
              key={index}
              className={cn(
                'block px-4',
                line.startsWith('+') && !line.startsWith('+++') && 'bg-diff-add',
                line.startsWith('-') && !line.startsWith('---') && 'bg-diff-del',
                line.startsWith('@@') && 'text-soft-foreground'
              )}
            >
              {line}
              {line === '' ? ' ' : ''}
            </span>
          ))}
        </pre>
      )}
    </section>
  );
}
