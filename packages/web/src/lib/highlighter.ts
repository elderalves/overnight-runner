import type { HighlighterCore } from 'shiki/core';

/**
 * The ONE Shiki highlighter for the diff viewer, ported from cezar's
 * lib/highlighter.ts (frontend-git-component-port.md). A second
 * `createHighlighterCore` call anywhere is a bug -- it would instantiate the
 * engine and re-fetch grammars twice.
 *
 * Bundle rules this module exists to enforce:
 *  - fine-grained core only (`shiki/core`), never the full `shiki` bundle --
 *    the full bundle lands every grammar in dist/;
 *  - the JavaScript regex engine, never the Oniguruma WASM blob;
 *  - core, engine and every grammar load through dynamic import(), so all of
 *    Shiki lives in lazy chunks off the main bundle -- a page with no diff
 *    downloads none of it;
 *  - grammars load on demand per file extension, from the explicit allowlist
 *    below (a fully dynamic import(`@shikijs/langs/${lang}`) would
 *    chunk-split all ~200 grammars);
 *  - every unknown language falls back to plaintext.
 *
 * Theming: ONE theme whose token colors are the --syn-* CSS variables from
 * styles/index.css.
 */

/** A highlighted line: what the diff viewer renders. */
export interface SynToken {
  content: string;
  /** A `var(--syn-*)` reference, or undefined for plaintext runs. */
  color?: string;
}

export interface SynHighlight {
  tokens: SynToken[][];
  fg: string;
  bg: string;
}

export const SYN_THEME = {
  name: 'overnight-runner-syn',
  type: 'dark' as const,
  fg: 'var(--syn-var)',
  bg: 'transparent',
  settings: [
    {
      scope: [
        'keyword',
        'storage',
        'constant.language',
        'variable.language',
        'entity.other.attribute-name',
        'support.type.property-name',
      ],
      settings: { foreground: 'var(--syn-key)' },
    },
    { scope: ['string', 'punctuation.definition.string'], settings: { foreground: 'var(--syn-str)' } },
    {
      scope: [
        'entity.name.function',
        'support.function',
        'entity.name.tag',
        'entity.name.type',
        'entity.name.class',
        'support.class',
        'support.type',
      ],
      settings: { foreground: 'var(--syn-fn)' },
    },
    { scope: ['comment', 'punctuation.definition.comment'], settings: { foreground: 'var(--syn-com)' } },
    {
      scope: ['constant.numeric', 'constant.character', 'constant.other', 'support.constant', 'keyword.other.unit'],
      settings: { foreground: 'var(--syn-num)' },
    },
    {
      scope: ['punctuation', 'keyword.operator', 'meta.brace', 'punctuation.separator', 'punctuation.terminator'],
      settings: { foreground: 'var(--syn-punc)' },
    },
    { scope: ['variable', 'entity.name.variable'], settings: { foreground: 'var(--syn-var)' } },
  ],
};

/** The grammar allowlist: what a diff realistically fences, one lazy chunk each. */
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  jsonc: () => import('@shikijs/langs/jsonc'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  python: () => import('@shikijs/langs/python'),
  markdown: () => import('@shikijs/langs/markdown'),
  css: () => import('@shikijs/langs/css'),
  html: () => import('@shikijs/langs/html'),
  diff: () => import('@shikijs/langs/diff'),
  yaml: () => import('@shikijs/langs/yaml'),
  toml: () => import('@shikijs/langs/toml'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
};

/** Fence/extension spellings for the grammars above. */
const ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  bash: 'shellscript',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  console: 'shellscript',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  golang: 'go',
  rs: 'rust',
  vue: 'html',
  xml: 'html',
};

const PLAIN = new Set(['', 'plaintext', 'text', 'txt', 'plain']);

/** The canonical grammar id for a language, or null when we don't carry one. */
export function canonicalLang(lang: string): string | null {
  const key = lang.trim().toLowerCase();
  if (key in LANG_LOADERS) return key;
  return ALIASES[key] ?? null;
}

export function isPlainLang(lang: string): boolean {
  return PLAIN.has(lang.trim().toLowerCase());
}

/** Extension -> the highlighter's language, or null for "don't highlight". */
export function langForPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  const extra: Record<string, string> = { mts: 'typescript', cts: 'typescript', htm: 'html' };
  return canonicalLang(extra[ext] ?? ext);
}

// ---- singleton state --------------------------------------------------------------------------

let core: HighlighterCore | null = null;
let corePromise: Promise<HighlighterCore> | null = null;
const loadedLangs = new Set<string>();
const langPromises = new Map<string, Promise<void>>();

function ensureCore(): Promise<HighlighterCore> {
  corePromise ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(
    async ([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) => {
      core = await createHighlighterCore({
        themes: [SYN_THEME],
        langs: [],
        // `forgiving`: a grammar rule the JS engine cannot compile degrades to
        // plaintext instead of throwing -- the documented safety valve for the no-WASM setup.
        engine: createJavaScriptRegexEngine({ forgiving: true }),
      });
      return core;
    }
  );
  return corePromise;
}

/** Load one grammar (idempotent). Resolves even on failure -- failure means plaintext, not error. */
export function ensureLang(lang: string): Promise<void> {
  const canonical = canonicalLang(lang);
  if (canonical === null || loadedLangs.has(canonical)) return Promise.resolve();
  let pending = langPromises.get(canonical);
  if (!pending) {
    pending = ensureCore()
      .then(async (highlighter) => {
        await highlighter.loadLanguage((await LANG_LOADERS[canonical]!()) as never);
        loadedLangs.add(canonical);
      })
      .catch(() => {
        langPromises.delete(canonical);
      });
    langPromises.set(canonical, pending);
  }
  return pending;
}

function plaintext(code: string): SynHighlight {
  return {
    tokens: code.split('\n').map((line) => [{ content: line }]),
    fg: 'var(--syn-var)',
    bg: 'transparent',
  };
}

export interface HighlightOptions {
  tokenizeTimeLimit?: number;
}

/** Highlight synchronously when the core and grammar are already resident, else null. */
export function highlightSync(code: string, lang: string, options: HighlightOptions = {}): SynHighlight | null {
  if (isPlainLang(lang)) return plaintext(code);
  const canonical = canonicalLang(lang);
  if (canonical === null) return plaintext(code);
  if (!core || !loadedLangs.has(canonical)) return null;
  try {
    const result = core.codeToTokens(code, {
      lang: canonical as never,
      theme: SYN_THEME.name,
      tokenizeTimeLimit: options.tokenizeTimeLimit,
    });
    return {
      tokens: result.tokens.map((line) => line.map(({ content, color }) => ({ content, color }))),
      fg: result.fg ?? 'var(--syn-var)',
      bg: 'transparent',
    };
  } catch {
    return plaintext(code);
  }
}

/** Highlight, loading the core and the grammar on the way when needed. Never rejects. */
export async function highlight(code: string, lang: string, options: HighlightOptions = {}): Promise<SynHighlight> {
  const sync = highlightSync(code, lang, options);
  if (sync) return sync;
  await ensureLang(lang);
  return highlightSync(code, lang, options) ?? plaintext(code);
}
