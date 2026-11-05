import type { LlmError } from '@/modules/analysis/domain/llm-error.js';

export interface RetryPolicy {
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** Retries after the first attempt; total attempts = maxRetries + 1. */
  maxRetries: number;
  /** Aborted when the whole run is interrupted (shutdown): no retry, current attempt cancelled. */
  signal: AbortSignal;
}

/** Injectable time and randomness so the policy is deterministic under test. */
export interface RetryDeps {
  random: () => number;
  /** Resolves after `ms`; must reject if `signal` aborts first. */
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Runs `fn` after `ms` and returns a canceller. */
  schedule: (fn: () => void, ms: number) => () => void;
}

export type FailureKind = LlmError['kind'] | 'timeout';
