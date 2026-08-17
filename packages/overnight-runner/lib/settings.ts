import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from 'contract';
import { rootDir } from './paths.ts';

const SETTINGS_FILENAME = 'settings.json';

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: 'claude',
  defaultTimeoutMinutes: 60,
  defaultIsolation: 'inline',
};

function settingsPath(repoPath: string): string {
  return path.join(rootDir(repoPath), SETTINGS_FILENAME);
}

// Read at `serve` startup and on every GET -- an in-memory-only setting would
// make the Settings view's "saved" state lie the moment the process restarts.
function readSettings(repoPath: string): Settings {
  const file = settingsPath(repoPath);
  if (!fs.existsSync(file)) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(repoPath: string, settings: Settings): void {
  const file = settingsPath(repoPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
}

export { settingsPath, DEFAULT_SETTINGS, readSettings, writeSettings };
