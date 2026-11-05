import type { PartialOutcome } from './process-analysis.types.js';

/** Thrown when a failure after the model answered could not be recorded; carries the answer for the runner's retry. */
export class AnalysisProcessingError extends Error {
  readonly partial: PartialOutcome;

  constructor(partial: PartialOutcome, cause: unknown) {
    super('analysis processing failed and the failure could not be recorded', { cause });
    this.name = 'AnalysisProcessingError';
    this.partial = partial;
  }
}
