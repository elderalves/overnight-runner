// Reject option-like git revision arguments -- a `-`/`--`-prefixed base/from
// ref is git argument injection (`git diff --output=/path` writes an
// arbitrary file, `--upload-pack=<cmd>` runs a command, etc). Ported
// verbatim from cezar's git-refs.ts dash guard, per
// backend-git-module-contract.md. Empty refs are rejected too: git would
// resolve them to an unexpected default rather than the intended revision.
function isSafeGitRef(ref: string): boolean {
  return ref.length > 0 && !ref.startsWith('-');
}

export { isSafeGitRef };
