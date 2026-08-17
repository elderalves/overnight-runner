import fs from 'node:fs';
import path from 'node:path';
import type { Settings } from 'contract';

const SETTINGS_FILENAME = '.overnight-runner-settings.json';

const DEFAULT_SETTINGS: Settings = {
  defaultProvider: 'claude',
  defaultTimeoutMinutes: 60,
  defaultIsolation: 'inline',
};

function settingsPath(repoPath: string): string {
  return path.join(repoPath, SETTINGS_FILENAME);
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
  fs.writeFileSync(settingsPath(repoPath), JSON.stringify(settings, null, 2) + '\n');
}

export { DEFAULT_SETTINGS, readSettings, writeSettings };
