import fs from 'node:fs';
import path from 'node:path';
import type { RunHistoryDetail, RunHistoryRow, RunHistorySummary } from 'contract';

// Reverses runSummary.ts's write() -- same column order (Job/Status/Duration/
// Isolation mode/Branch produced/Provider/Commit ref/Notes), same `\|`
// escaping -- reusing that knowledge instead of shipping a second Markdown-
// table parser to the browser. See api-endpoint-contract.md's "History".
function unescapeCell(cell: string): string {
  return cell.trim().replace(/\\\|/g, '|');
}

function splitRow(row: string): string[] {
  const trimmed = row.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split(/(?<!\\)\|/).map(unescapeCell);
}

function parseRunSummary(id: string, content: string): RunHistoryDetail {
  const lines = content.split('\n');
  let i = 0;

  if (lines[i]?.trim() !== '---') throw new Error(`malformed run summary "${id}": missing frontmatter`);
  i++;
  const fm: Record<string, string> = {};
  while (i < lines.length && lines[i]?.trim() !== '---') {
    const line = lines[i] ?? '';
    const idx = line.indexOf(':');
    if (idx !== -1) fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    i++;
  }
  i++; // past closing ---

  while (i < lines.length && (lines[i] ?? '').trim() === '') i++;
  const totals = (lines[i] ?? '').trim();
  i++;

  while (i < lines.length && (lines[i] ?? '').trim() === '') i++;
  i++; // table header row
  i++; // divider row

  const jobs: RunHistoryRow[] = [];
  while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
    const cells = splitRow(lines[i]!);
    jobs.push({
      job: cells[0] ?? '',
      status: cells[1] ?? '',
      duration: cells[2] ?? '',
      isolation: cells[3] ?? '',
      branchProduced: cells[4] ?? '',
      provider: cells[5] ?? '',
      commitRef: cells[6] ?? '',
      notes: cells[7] ?? '',
    });
    i++;
  }

  return {
    id,
    runStatus: fm.run_status === 'in-progress' ? 'in-progress' : 'complete',
    started: fm.started ?? '',
    ended: fm.ended ?? '',
    baseBranch: fm.base_branch ?? '',
    provider: fm.provider && fm.provider !== 'undefined' ? fm.provider : undefined,
    totals,
    jobs,
  };
}

const SAFE_ID = /^[\w.-]+$/;

function runsDir(repoPath: string): string {
  return path.join(repoPath, 'runs');
}

function listRuns(repoPath: string): RunHistorySummary[] {
  const dir = runsDir(repoPath);
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .reverse(); // newest-first: filenames are YYYY-MM-DD-HHmm, lexicographic = chronological

  return files.map((f) => {
    const id = path.basename(f, '.md');
    const { jobs: _jobs, ...summary } = parseRunSummary(id, fs.readFileSync(path.join(dir, f), 'utf8'));
    return summary;
  });
}

function readRun(repoPath: string, id: string): RunHistoryDetail | null {
  if (!SAFE_ID.test(id)) return null;
  const filePath = path.join(runsDir(repoPath), `${id}.md`);
  if (!fs.existsSync(filePath)) return null;
  return parseRunSummary(id, fs.readFileSync(filePath, 'utf8'));
}

export { listRuns, readRun };
