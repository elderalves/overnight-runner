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
  // Full-length start/end refs this job executed between, empty when this run
  // never executed the job -- the per-job Git routes' `jobStartRef..jobEndRef`
  // source. See per-job-diff-semantics.md.
  jobStartRef: string;
  jobEndRef: string;
  notes: string;
}

export interface RunHistorySummary {
  id: string;
  runStatus: 'in-progress' | 'complete';
  started: string;
  baseBranch: string;
  provider?: string;
  totals: string;
}

export interface RunHistoryDetail extends RunHistorySummary {
  jobs: RunHistoryRow[];
}
