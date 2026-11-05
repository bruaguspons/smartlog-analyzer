import { AnalysisProcessingError } from './analysis-processing-error.js';
import { markInternalError } from './mark-internal-error.js';
import { processAnalysis } from './process-analysis.js';
import { type AnalysisJob, type PartialOutcome, type ProcessDeps } from './process-analysis.types.js';
import type { JobLog } from '@/modules/analysis/domain/job-log.types.js';

interface InFlight {
  controller: AbortController;
  done: Promise<void>;
}

/**
 * Owns the lifecycle of in-process analysis jobs and guarantees each reaches a terminal state:
 * `processAnalysis` writes the outcomes it classifies, `finally` closes the rest as INTERNAL_ERROR,
 * and `shutdown()` aborts the LLM calls so the jobs close themselves as INTERRUPTED.
 */
export class AnalysisRunner {
  private readonly inFlight = new Set<InFlight>();
  private closing = false;
  private readonly deps: ProcessDeps;

  constructor(deps: ProcessDeps) {
    this.deps = deps;
  }

  /** Fire-and-forget: the job never rejects; failures are logged through `log` (the request logger). */
  start(job: AnalysisJob, log: JobLog): void {
    const controller = new AbortController();
    if (this.closing) controller.abort(new Error('Runner is shutting down'));
    const entry: InFlight = { controller, done: Promise.resolve() };
    entry.done = this.run(job, controller.signal, log).finally(() => {
      this.inFlight.delete(entry);
    });
    this.inFlight.add(entry);
  }

  /** Aborts every in-flight job and waits until each one has written its terminal state. */
  async shutdown(): Promise<void> {
    this.closing = true;
    for (const { controller } of this.inFlight) controller.abort(new Error('Server is shutting down'));
    await this.idle();
  }

  /** Resolves when no job is running. Also the seam tests use to await a started job. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight].map((entry) => entry.done));
    }
  }

  private async run(job: AnalysisJob, signal: AbortSignal, log: JobLog): Promise<void> {
    let settled = false;
    let partial: PartialOutcome | undefined;
    try {
      await processAnalysis(job, this.deps, signal, log);
      settled = true;
    } catch (error) {
      if (error instanceof AnalysisProcessingError) partial = error.partial;
      log.error({ err: error, analysisId: job.analysisId }, 'analysis job failed unexpectedly');
    } finally {
      if (!settled) {
        try {
          await markInternalError(job, this.deps, partial);
        } catch (error) {
          // Nothing else can be done here; startup recovery closes the row if the process dies first.
          log.error({ err: error, analysisId: job.analysisId }, 'could not record the analysis failure');
        }
      }
    }
  }
}
