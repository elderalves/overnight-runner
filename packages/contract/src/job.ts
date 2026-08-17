// Wire-format shapes for a job, camelCase throughout, translated from the
// on-disk `chain_from` frontmatter at the route boundary (see
// .alves/issues/overnight-runner-web-interface/api-endpoint-contract.md).

export type IsolationMode = 'inline' | 'worktree' | 'chained';

export type JobStatus = 'pending' | 'done' | 'blocked';

// The run-outcome vocabulary from root CONTEXT.md's "Run outcome" entry --
// exactly the union lib/runSummary.ts's outcomeFor() returns.
export type RunOutcome = 'PASS' | 'BLOCKED' | 'RUNNING' | 'SKIPPED' | 'NOT RUN';

// A presentation-tier label, not a CONTEXT.md term: blends job status (idle,
// before/between runs) with run outcome (mid- or post-run) into the single
// ready-to-render value design-tokens-component-mapping.md's StatusPill tone
// map expects -- computed server-side so idle-vs-mid-run-cutoff ("PENDING"
// vs. "NOT RUN" for a job that's never executed) never has to be re-derived
// client-side.
export type JobDisplayStatus = RunOutcome | 'PENDING' | 'DONE';

export interface Job {
  identity: string;
  isolation: string;
  chainFrom: string | null;
  provider: string | null;
  status: JobStatus;
  displayStatus: JobDisplayStatus;
  // The composer's pre-fill (edit/duplicate) is purely client-side -- no
  // GET /api/jobs/:identity route -- so the queue array the browser already
  // holds via SSE must carry this. See api-endpoint-contract.md's "Job routes".
  body: string;
  notes: string;
  providerUsed?: string;
  duration?: number;
  branchProduced?: string;
  commitRef?: string;
}

export interface JobFields {
  isolation: IsolationMode;
  provider: string | null;
  chainFrom: string | null;
  body: string;
}

export interface JobCreateInput extends JobFields {
  slug: string;
}

export type JobUpdateInput = JobFields;
