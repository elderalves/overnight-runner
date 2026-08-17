import fs from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, rootDir, jobsDir, runsDir } from './paths.ts';
import { settingsPath } from './settings.ts';

// Pre-.overnight-runner/ flat layout, keyed by where each one lives now.
const OLD_ARTIFACTS: { old: string; next: (repoPath: string) => string }[] = [
  { old: 'jobs', next: jobsDir },
  { old: 'runs', next: runsDir },
  { old: '.overnight-runner-settings.json', next: settingsPath },
];

// One-shot, called at the top of every entry point (see bin/overnight-runner.ts
// and server/app.ts). Ensures .overnight-runner/ ignores its own contents --
// so no target repo's own .gitignore is ever touched -- then moves any
// pre-existing flat-layout jobs/runs/settings into it.
//
// .worktrees/ is deliberately excluded: isolation.teardown() always removes it
// after every job, so nothing of value is ever left there to migrate, and
// blindly moving a leftover worktree directory would desync git's own
// worktree registration (.git/worktrees/<name>/gitdir).
function migrate(repoPath: string): void {
  const dir = rootDir(repoPath);
  fs.mkdirSync(dir, { recursive: true });

  const gitignorePath = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, '*\n');

  const migrated: string[] = [];
  for (const { old, next } of OLD_ARTIFACTS) {
    const oldPath = path.join(repoPath, old);
    const nextPath = next(repoPath);
    if (!fs.existsSync(oldPath)) continue;
    if (fs.existsSync(nextPath)) {
      console.error(`warning: both "${old}" and "${path.relative(repoPath, nextPath)}" exist -- leaving "${old}" in place`);
      continue;
    }
    fs.renameSync(oldPath, nextPath);
    migrated.push(old);
  }

  if (migrated.length > 0) {
    console.log(`Migrated ${migrated.join(', ')} into ${ROOT_DIR}/`);
  }
}

export { migrate };
