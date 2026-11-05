import type { AnalysisErrorCode } from '@/modules/analysis/domain/analysis.types.js';

/** Terminal outcome of a call that did not succeed, already mapped to the persisted error code. */
export class LlmCallFailure extends Error {
  readonly code: AnalysisErrorCode;
  readonly attempts: number;

  constructor(code: AnalysisErrorCode, attempts: number, options?: ErrorOptions) {
    // The message intentionally omits the cause text: provider errors may echo request details.
    super(`LLM call failed with ${code} after ${String(attempts)} attempt(s)`, options);
    this.name = 'LlmCallFailure';
    this.code = code;
    this.attempts = attempts;
  }
}
