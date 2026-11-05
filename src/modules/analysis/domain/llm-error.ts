import type { LlmErrorKind } from './llm-client.types.js';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;

  constructor(kind: LlmErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LlmError';
    this.kind = kind;
  }
}
