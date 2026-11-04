import type { AnalysisErrorCode, AnalysisView, NewAnalysis, NewFinding, TokenUsage } from './analysis.js';

export type CreateProcessingOutcome =
  | { created: true }
  /** Another analysis is PROCESSING; `runningId` is null only if it finished before it could be read. */
  | { created: false; runningId: string | null };

export interface CompleteInput {
  summary: string;
  findings: NewFinding[];
  rawResponse: string;
  usage: TokenUsage | null;
  durationMs: number;
}

export interface FailInput {
  errorCode: AnalysisErrorCode;
  errorMessage: string;
  rawResponse: string | null;
  usage: TokenUsage | null;
  durationMs: number;
}

export interface AnalysisRepository {
  /**
   * Inserts the analysis as PROCESSING together with its logs, atomically.
   * At most one analysis can be PROCESSING: the store enforces it, not a prior check, so two concurrent requests cannot both pass.
   */
  createProcessing(analysis: NewAnalysis, logIds: readonly string[]): Promise<CreateProcessingOutcome>;
  /**
   * Compare-and-set PROCESSING -> COMPLETED, saving findings and their logs in one step.
   * Returns false, writing nothing, when the analysis is not PROCESSING (the first terminal write wins).
   * Rejects, writing nothing, when a finding references a log outside the analysis.
   */
  complete(id: string, input: CompleteInput): Promise<boolean>;
  /** Compare-and-set PROCESSING -> FAILED. Returns false when the analysis is not PROCESSING. */
  fail(id: string, input: FailInput): Promise<boolean>;
  /** Startup recovery: every PROCESSING analysis becomes FAILED. Returns their ids. */
  failAllProcessing(input: { errorCode: 'INTERRUPTED'; errorMessage: string }): Promise<string[]>;
  findById(id: string): Promise<AnalysisView | null>;
}
