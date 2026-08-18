import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useImperativeHandle, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react';
import { Virtualizer, type VirtualizerHandle } from 'virtua';

import type { DiffStat } from 'contract';
import { DiffStatLabel } from '@/components/diff-stat';
import { highlight, highlightSync, langForPath, type SynToken } from '@/lib/highlighter';
import { cn } from '@/lib/utils';

import { diffRenderMode, diffRowCount, estimateFileHeight, fileKey, widestLineChars } from './diff-scroll';
import { ImagePreview, shouldPreviewImage } from './image-preview';
import {
  buildSplitRows,
  buildUnifiedRows,
  contextGaps,
  parsePatch,
  type ContextGap,
  type DiffCell,
  type Hunk,
  type HunkLine,
  type SplitRow,
  type UnifiedRow,
} from './parse-patch';
import type { DiffFileChange, DiffProps } from './types';
import { overlaySegments } from './word-diff';

/** Past this many patch lines a file skips syntax highlighting -- plaintext beats jank. */
const HIGHLIGHT_MAX_LINES = 1500;

/** The card element for a path, matched on dataset rather than an attribute selector. */
export function findFileElement(root: ParentNode | null, path: string): HTMLElement | undefined {
  if (!root) return undefined;
  for (const element of root.querySelectorAll<HTMLElement>('[data-slot="diff-file"]')) {
    if (element.dataset.path === path) return element;
  }
  return undefined;
}

export function DiffView({ files, mode = 'unified', wrap = false, viewRef, className }: DiffProps) {
  const stat: DiffStat = useMemo(
    () => ({
      adds: files.reduce((sum, file) => sum + file.adds, 0),
      dels: files.reduce((sum, file) => sum + file.dels, 0),
      files: files.length,
    }),
    [files]
  );

  // PER-FILE STATE LIVES HERE, not in the card. Virtualization unmounts
  // off-screen cards, and a collapsed file must survive scrolling away and
  // back -- state inside the card would silently reset.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  const toggleFile = useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const rowCount = useMemo(() => diffRowCount(files), [files]);
  const [search] = useState(() => (typeof window === 'undefined' ? '' : window.location.search));
  const renderMode = diffRenderMode(search, rowCount);

  const scrollElRef = useRef<HTMLElement | null>(null);
  const virtualizerRef = useRef<VirtualizerHandle | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    viewRef,
    () => ({
      scrollToPath: (path: string) => {
        const index = files.findIndex((file) => file.path === path);
        if (index === -1) return;
        const handle = virtualizerRef.current;
        if (handle) handle.scrollToIndex(index, { align: 'start' });
        else findFileElement(rootRef.current, path)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
    }),
    [files]
  );

  const card = (file: DiffFileChange) => {
    const key = fileKey(file);
    return <DiffFileCard key={key} file={file} open={!collapsed.has(key)} onToggle={() => toggleFile(key)} mode={mode} wrap={wrap} />;
  };

  return (
    <div
      ref={(el) => {
        rootRef.current = el;
        if (el) scrollElRef.current = el.closest<HTMLElement>('[data-slot="main"]');
      }}
      data-slot="diff"
      data-mode={mode}
      className={cn('flex min-w-0 flex-col', className)}
    >
      <p data-slot="diff-totals" className="flex items-center gap-2 px-1 pb-3 text-xs text-muted-foreground">
        <span>
          {stat.files} {stat.files === 1 ? 'file' : 'files'} changed
        </span>
        <DiffStatLabel stat={stat} />
      </p>
      {renderMode === 'virtual' ? (
        <VirtualFiles files={files} handleRef={virtualizerRef} scrollElRef={scrollElRef} card={card} />
      ) : (
        <div data-slot="diff-files" data-virtualized="false">
          {files.map((file) => (
            <div
              key={fileKey(file)}
              data-slot="diff-file-slot"
              style={{ containIntrinsicBlockSize: `auto ${estimateFileHeight(file)}px` }}
              className="pb-3 [content-visibility:auto]"
            >
              {card(file)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The file cards through virtua, on the app shell's scroller ([data-slot="main"]). */
function VirtualFiles({
  files,
  handleRef,
  scrollElRef,
  card,
}: {
  files: DiffFileChange[];
  handleRef: RefObject<VirtualizerHandle | null>;
  scrollElRef: RefObject<HTMLElement | null>;
  card: (file: DiffFileChange) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [startMargin, setStartMargin] = useState(0);
  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const scroller = scrollElRef.current;
      if (!container || !scroller) return;
      setStartMargin(Math.max(0, Math.round(container.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [scrollElRef]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (el) scrollElRef.current = el.closest<HTMLElement>('[data-slot="main"]');
      }}
      data-slot="diff-files"
      data-virtualized="true"
    >
      <Virtualizer ref={handleRef} scrollRef={scrollElRef} startMargin={startMargin}>
        {files.map((file) => (
          <div key={fileKey(file)} data-slot="diff-file-slot" className="pb-3">
            {card(file)}
          </div>
        ))}
      </Virtualizer>
    </div>
  );
}

const STATUS_BADGE: Partial<Record<DiffFileChange['status'], string>> = {
  added: 'added',
  deleted: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
};

/** One file: sticky header (path, status, +/-, collapse) over the row grid. */
function DiffFileCard({ file, open, onToggle, mode, wrap }: { file: DiffFileChange; open: boolean; onToggle: () => void; mode: 'unified' | 'split'; wrap: boolean }) {
  const badge = STATUS_BADGE[file.status];
  return (
    <section data-slot="diff-file" data-path={file.path} className="min-w-0 overflow-clip rounded-md border border-border bg-card">
      <header className="sticky top-[var(--diff-sticky-top,0px)] z-10 rounded-t-md border-b border-border/50 bg-card">
        <button type="button" data-slot="diff-file-header" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/50">
          <ChevronRightIcon className={cn('size-3.5 shrink-0 text-soft-foreground transition-transform', open && 'rotate-90')} aria-hidden="true" />
          <span data-slot="diff-file-path" className="min-w-0 truncate font-mono text-xs font-medium">
            {file.oldPath ? (
              <>
                <span className="text-soft-foreground">{file.oldPath} → </span>
                {file.path}
              </>
            ) : (
              file.path
            )}
          </span>
          {badge ? <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">{badge}</span> : null}
          {file.image ? (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">image</span>
          ) : file.binary ? (
            <span className="shrink-0 rounded-sm bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">binary</span>
          ) : null}
          <span className="ml-auto shrink-0">
            <DiffStatLabel stat={{ adds: file.adds, dels: file.dels, files: 1 }} className="text-[11px]" />
          </span>
        </button>
      </header>
      {open ? <DiffFileBody file={file} mode={mode} wrap={wrap} /> : null}
    </section>
  );
}

function DiffFileBody({ file, mode, wrap }: { file: DiffFileChange; mode: 'unified' | 'split'; wrap: boolean }) {
  const parsed = useMemo(() => parsePatch(file.patch), [file.patch]);
  const gaps = useMemo(() => contextGaps(parsed.hunks), [parsed.hunks]);

  const lineList = useMemo(() => parsed.hunks.flatMap((hunk) => hunk.lines), [parsed.hunks]);
  const lineIndex = useMemo(() => new Map(lineList.map((line, index) => [line, index])), [lineList]);
  const tokens = useFileTokens(file.path, lineList);

  const rows = useMemo(() => (mode === 'unified' ? buildUnifiedRows(parsed.hunks, gaps) : null), [mode, parsed.hunks, gaps]);
  const splitRows = useMemo(() => (mode === 'split' ? buildSplitRows(parsed.hunks, gaps) : null), [mode, parsed.hunks, gaps]);

  const widthFloor = useMemo(
    () => (mode === 'unified' && !wrap ? { minInlineSize: `calc(${widestLineChars(file.patch)}ch + 7rem)` } : undefined),
    [mode, wrap, file.patch]
  );

  if (shouldPreviewImage(file)) return <ImagePreview file={file} />;
  if (file.binary) return <Note>Binary file — no text diff.</Note>;
  if (parsed.hunks.length === 0) {
    return <Note>{parsed.truncated ? 'Patch truncated by the server.' : 'No content changes (metadata only).'}</Note>;
  }

  const tokensFor = (line: HunkLine): SynToken[] | null => {
    if (!tokens) return null;
    const index = lineIndex.get(line);
    return index === undefined ? null : (tokens[index] ?? null);
  };

  return (
    <div data-slot="diff-file-body" data-wrap={wrap || undefined} className={cn('py-1 font-mono text-xs leading-[1.7]', !wrap && 'overflow-x-auto')}>
      <div data-slot="diff-rows" style={widthFloor} className="[&>*]:[contain-intrinsic-block-size:auto_20px] [&>*]:[content-visibility:auto]">
        {rows ? rows.map((row, index) => <UnifiedRowView key={index} row={row} wrap={wrap} tokensFor={tokensFor} />) : null}
        {splitRows ? splitRows.map((row, index) => <SplitRowView key={index} row={row} wrap={wrap} tokensFor={tokensFor} />) : null}
      </div>
      {parsed.truncated ? <Note>Patch truncated by the server — counts above remain exact.</Note> : null}
    </div>
  );
}

/** Load-and-cache this file's syntax tokens through the shared singleton (never rejects). */
function useFileTokens(path: string, lineList: HunkLine[]): SynToken[][] | null {
  const text = useMemo(() => (lineList.length > HIGHLIGHT_MAX_LINES ? null : lineList.map((line) => line.text).join('\n')), [lineList]);
  const lang = useMemo(() => langForPath(path), [path]);
  const [loaded, setLoaded] = useState<{ text: string; tokens: SynToken[][] } | null>(null);
  useEffect(() => {
    if (text === null || lang === null) return;
    let cancelled = false;
    void highlight(text, lang).then((result) => {
      if (!cancelled) setLoaded({ text, tokens: result.tokens });
    });
    return () => {
      cancelled = true;
    };
  }, [text, lang]);
  if (text === null || lang === null) return null;
  if (loaded?.text === text) return loaded.tokens;
  return highlightSync(text, lang)?.tokens ?? null;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-4 py-2.5 text-xs text-soft-foreground">{children}</p>;
}

// ---- rows ---------------------------------------------------------------------------------

const LINE_BG: Record<HunkLine['kind'], string | undefined> = {
  add: 'bg-diff-add',
  del: 'bg-diff-del',
  context: undefined,
};
const MARKER: Record<HunkLine['kind'], string> = { add: '+', del: '−', context: ' ' };

function HunkHeaderRow({ hunk }: { hunk: Hunk }) {
  return (
    <div data-slot="diff-hunk" className="bg-muted/40 px-4 py-0.5 whitespace-pre text-soft-foreground">
      {hunk.header}
    </div>
  );
}

/** "... N unchanged lines" -- always a static separator in this port (no expansion source). */
function GapRow({ gap }: { gap: ContextGap }) {
  const label = gap.count === undefined ? '⋯ unchanged lines to end of file' : `⋯ ${gap.count} unchanged ${gap.count === 1 ? 'line' : 'lines'}`;
  return (
    <div data-slot="diff-gap" className="border-y border-border/40 bg-muted/20 px-4 py-0.5 text-[11px] text-soft-foreground">
      {label}
    </div>
  );
}

/** A line's content: syntax tokens x word marks, empty lines kept one row tall. */
function LineContent({ cell, tokens, wrap }: { cell: DiffCell; tokens: SynToken[] | null; wrap: boolean }) {
  const segments = overlaySegments(tokens, cell.spans, cell.line.text);
  const markClass = cell.line.kind === 'add' ? 'bg-diff-add-strong' : 'bg-diff-del-strong';
  return (
    <span className={cn('min-w-0 flex-1 pr-4', wrap ? 'break-words whitespace-pre-wrap' : 'whitespace-pre')}>
      {segments.map((segment, index) => (
        <span
          key={index}
          data-word={segment.changed ? cell.line.kind : undefined}
          style={segment.color !== undefined ? { color: segment.color } : undefined}
          className={segment.changed ? cn('rounded-[2px]', markClass) : undefined}
        >
          {segment.text}
        </span>
      ))}
      {cell.line.text === '' ? ' ' : ''}
    </span>
  );
}

function Gutter({ value }: { value: number | undefined }) {
  return <span className="w-10 shrink-0 pr-2 text-right text-soft-foreground/70 tabular-nums select-none">{value ?? ''}</span>;
}

function UnifiedRowView({ row, wrap, tokensFor }: { row: UnifiedRow; wrap: boolean; tokensFor: (line: HunkLine) => SynToken[] | null }) {
  if (row.type === 'hunk') return <HunkHeaderRow hunk={row.hunk} />;
  if (row.type === 'gap') return <GapRow gap={row.gap} />;
  const { line } = row.cell;
  return (
    <div data-slot="diff-line" data-line={line.kind} className={cn('flex', LINE_BG[line.kind])}>
      <Gutter value={line.oldLine} />
      <Gutter value={line.newLine} />
      <span className="w-4 shrink-0 text-soft-foreground select-none">{MARKER[line.kind]}</span>
      <LineContent cell={row.cell} tokens={tokensFor(line)} wrap={wrap} />
    </div>
  );
}

function SplitRowView({ row, wrap, tokensFor }: { row: SplitRow; wrap: boolean; tokensFor: (line: HunkLine) => SynToken[] | null }) {
  if (row.type === 'hunk') return <HunkHeaderRow hunk={row.hunk} />;
  if (row.type === 'gap') return <GapRow gap={row.gap} />;
  return (
    <div data-slot="diff-pair" className="grid grid-cols-2">
      <SplitCell cell={row.left} side="old" tokensFor={tokensFor} wrap={wrap} />
      <SplitCell cell={row.right} side="new" tokensFor={tokensFor} wrap={wrap} />
    </div>
  );
}

function SplitCell({ cell, side, tokensFor, wrap }: { cell?: DiffCell; side: 'old' | 'new'; tokensFor: (line: HunkLine) => SynToken[] | null; wrap: boolean }) {
  if (!cell) {
    return <div data-slot="diff-cell-empty" className={cn('bg-muted/20', side === 'new' && 'border-l border-border/40')} />;
  }
  const { line } = cell;
  return (
    <div data-slot="diff-cell" data-line={line.kind} className={cn('flex min-w-0 overflow-x-auto', LINE_BG[line.kind], side === 'new' && 'border-l border-border/40')}>
      <Gutter value={side === 'old' ? line.oldLine : line.newLine} />
      <span className="w-4 shrink-0 text-soft-foreground select-none">{MARKER[line.kind]}</span>
      <LineContent cell={cell} tokens={tokensFor(line)} wrap={wrap} />
    </div>
  );
}
