import type { IsolationMode } from './job.ts';

export interface Settings {
  defaultProvider: string;
  defaultTimeoutMinutes: number;
  defaultIsolation: IsolationMode;
}
