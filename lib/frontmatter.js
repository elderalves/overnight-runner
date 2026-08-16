'use strict';

const fs = require('fs');
const path = require('path');

// Jobs use scalar-only YAML frontmatter (see .alves/issues/job-file-format.md) --
// no nesting, no lists -- so a hand-rolled parser is enough and avoids a dependency.
function splitFrontmatter(raw) {
  if (!raw.startsWith('---\n') && raw !== '---') {
    return { hasFm: false };
  }
  const closeIdx = raw.indexOf('\n---', 4);
  if (closeIdx === -1) return { hasFm: false };
  const closeLineEnd = raw.indexOf('\n', closeIdx + 1);
  const fmEnd = closeLineEnd === -1 ? raw.length : closeLineEnd + 1;
  return {
    hasFm: true,
    fm: raw.slice(4, closeIdx),
    body: raw.slice(fmEnd),
    fmStart: 4,
    fmEnd,
  };
}

function parseFrontmatter(fm) {
  const out = {};
  for (const line of fm.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (value.length >= 2 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readJobFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parts = splitFrontmatter(raw);
  const frontmatter = parts.hasFm ? parseFrontmatter(parts.fm) : {};
  const body = parts.hasFm ? parts.body : raw;
  return { frontmatter, body, raw };
}

// Identity per job-file-format.md: filename minus extension, overridable by `slug`.
function identityFor(fileName, frontmatter) {
  if (frontmatter && frontmatter.slug && frontmatter.slug.trim()) return frontmatter.slug.trim();
  return path.basename(fileName, '.md');
}

// Writes back the `status` field only -- used by the runner itself for the two
// cases where a job never reaches implement-overnight's own step-8 write-back
// (chain_from validation failure, worktree branch collision). The skill owns
// every other status write.
function writeStatus(filePath, status) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parts = splitFrontmatter(raw);
  if (!parts.hasFm) {
    fs.writeFileSync(filePath, `---\nstatus: ${status}\n---\n${raw}`);
    return;
  }
  const lines = parts.fm.split('\n');
  let found = false;
  const newLines = lines.map((line) => {
    if (line.trim().startsWith('status:')) {
      found = true;
      return `status: ${status}`;
    }
    return line;
  });
  if (!found) newLines.push(`status: ${status}`);
  // parts.fm excludes the closing "---" delimiter (see splitFrontmatter), so it
  // must be re-inserted here or the rewritten file loses it.
  const newRaw = raw.slice(0, parts.fmStart) + newLines.join('\n') + '\n---\n' + raw.slice(parts.fmEnd);
  fs.writeFileSync(filePath, newRaw);
}

module.exports = { readJobFile, writeStatus, identityFor };
