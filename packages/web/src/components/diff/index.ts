// Public surface of the diff facade -- consumers import Diff and its prop
// types from here and nothing else. The parser and word-diff modules are
// internal. Ported from cezar's components/diff/index.ts.
export { Diff } from './diff';
export type { DiffFileChange, DiffHandle, DiffMode, DiffProps } from './types';
