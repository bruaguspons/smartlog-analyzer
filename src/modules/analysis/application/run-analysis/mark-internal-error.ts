import { INTERNAL_MESSAGE } from './process-analysis.const.js';
import { durationSince } from './duration-since.js';
import type { AnalysisJob, PartialOutcome, ProcessDeps } from './process-analysis.types.js';

/** Compare-and-set to FAILED/INTERNAL_ERROR; also the last-resort write of the runner's `finally`. */
export function markInternalError(
  job: AnalysisJob,
  deps: ProcessDeps,
  partial: PartialOutcome = { rawResponse: null, usage: null },
): Promise<boolean> {
  return deps.repo.fail(job.analysisId, {
    errorCode: 'INTERNAL_ERROR',
    errorMessage: INTERNAL_MESSAGE,
    ...partial,
    durationMs: durationSince(job, deps),
  });
}
