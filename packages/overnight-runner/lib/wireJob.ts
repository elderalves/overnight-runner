import type { Job as WireJob, JobDisplayStatus } from 'contract';
import { outcomeFor } from './runSummary.ts';
import type { Job } from './queue.ts';

// Idle (no run this server session has touched this job): show the job's own
// persisted status, not a run-outcome term -- CONTEXT.md deliberately keeps
// "job status" and "run outcome" distinct, and a job that's simply never run
// is "pending," not "NOT RUN" (that term means a run started but was cut
// short before reaching it -- see runSummary.ts's outcomeFor()).
function idleDisplayStatus(status: Job['status']): JobDisplayStatus {
  if (status === 'done') return 'DONE';
  if (status === 'blocked') return 'BLOCKED';
  return 'PENDING';
}

// The one place an internal (in-memory) Job becomes the browser's camelCase
// wire shape. `inRunContext` is true while ServeState holds this job as part
// of the currently-running (or last-completed-this-session) run's own array
// -- only then does outcomeFor()'s PASS/BLOCKED/RUNNING/SKIPPED/NOT RUN
// vocabulary apply; otherwise this is a plain idle queue listing.
function toWireJob(job: Job, inRunContext: boolean): WireJob {
  return {
    identity: job.identity,
    isolation: job.isolation,
    chainFrom: job.chainFrom,
    provider: job.provider,
    status: job.status as WireJob['status'],
    displayStatus: inRunContext ? outcomeFor(job) : idleDisplayStatus(job.status),
    body: job.body,
    notes: job.notes,
    providerUsed: job.providerUsed,
    duration: job.duration,
    branchProduced: job.branchProduced,
    commitRef: job.commitRef,
  };
}

export { toWireJob };
