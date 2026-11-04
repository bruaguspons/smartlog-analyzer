import type { Log } from '../../logs/domain/log.js';
import type { TokenUsage } from './analysis.js';

/** A log as presented to the model: `ref` is its 1-based position in the batch. */
export interface NumberedLog {
  ref: number;
  log: Log;
}

export interface LlmRequest {
  /** Rendered instructions (role, output contract, data-only rule). */
  systemInstruction: string;
  /** Rendered user content: the delimited, numbered logs. */
  prompt: string;
  /** The same logs in structured form, so adapters such as the mock need not parse the prompt. */
  entries: readonly NumberedLog[];
}

export interface LlmResult {
  text: string;
  usage: TokenUsage | null;
}

export interface LlmClient {
  readonly provider: string;
  readonly model: string;
  /** Aborting `signal` must cancel the call. Timeouts and interruptions are classified by the retry wrapper. */
  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResult>;
}

/** Failure categories a client can report; timeout and interruption are derived from signals instead. */
export type LlmErrorKind = 'network' | 'rate_limited' | 'unavailable' | 'rejected';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmError';
    this.kind = kind;
  }
}
