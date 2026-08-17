// Structured JSON parsed server-side from runs/<id>.md -- see
// .alves/issues/overnight-runner-build-spec/run-summary-report-format.md for
// the on-disk table this mirrors.

export interface RunHistoryRow {
  job: string;
  status: string;
  duration: string;
  isolation: string;
  branchProduced: string;
  provider: string;
  commitRef: string;
  notes: string;
}

export interface RunHistorySummary {
  id: string;
  runStatus: 'in-progress' | 'complete';
  started: string;
  ended: string;
  baseBranch: string;
  provider?: string;
  totals: string;
}

export interface RunHistoryDetail extends RunHistorySummary {
  jobs: RunHistoryRow[];
}
