import type { AnalysisErrorCode } from '../domain/analysis.js';
import { LlmError } from '../domain/llm-client.js';

const BASE_DELAY_MS = 1000;

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

const defaultDeps: RetryDeps = {
  random: Math.random,
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};

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

type FailureKind = LlmError['kind'] | 'timeout';

const CODE_BY_KIND: Record<FailureKind, AnalysisErrorCode> = {
  timeout: 'LLM_TIMEOUT',
  rate_limited: 'LLM_RATE_LIMITED',
  network: 'LLM_UNAVAILABLE',
  unavailable: 'LLM_UNAVAILABLE',
  rejected: 'LLM_REQUEST_REJECTED',
};

/** `1000 * 2^retryIndex` jittered by +-25%; `random` is in [0, 1]. Retry-After is deliberately ignored. */
export function backoffDelayMs(retryIndex: number, random: number): number {
  return BASE_DELAY_MS * 2 ** retryIndex * (0.75 + random * 0.5);
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason as Error);
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs `fn` with a per-attempt timeout and retries retryable failures (timeout, network, 429, 5xx)
 * with exponential backoff and jitter. Non-retryable failures and run interruption stop at once.
 * Errors that are not `LlmError` are programming errors: rethrown untouched, never retried.
 */
export async function callWithRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  policy: RetryPolicy,
  overrides: Partial<RetryDeps> = {},
): Promise<T> {
  const deps: RetryDeps = { ...defaultDeps, ...overrides };
  const maxAttempts = policy.maxRetries + 1;

  for (let attempt = 1; ; attempt += 1) {
    if (policy.signal.aborted) throw new LlmCallFailure('INTERRUPTED', attempt - 1);

    const attemptController = new AbortController();
    let timedOut = false;
    const cancelTimer = deps.schedule(() => {
      timedOut = true;
      attemptController.abort(new Error('LLM attempt timed out'));
    }, policy.timeoutMs);
    const signal = AbortSignal.any([policy.signal, attemptController.signal]);

    let kind: FailureKind;
    let cause: unknown;
    try {
      // The race guarantees the timeout/interrupt even if the client ignores the signal.
      const aborted = rejectOnAbort(signal);
      aborted.catch(() => undefined);
      return await Promise.race([fn(signal), aborted]);
    } catch (error) {
      cause = error;
      if (policy.signal.aborted) throw new LlmCallFailure('INTERRUPTED', attempt, { cause });
      if (timedOut) kind = 'timeout';
      else if (error instanceof LlmError) kind = error.kind;
      else throw error;
    } finally {
      cancelTimer();
    }

    if (kind === 'rejected' || attempt >= maxAttempts) {
      throw new LlmCallFailure(CODE_BY_KIND[kind], attempt, { cause });
    }

    try {
      await deps.sleep(backoffDelayMs(attempt - 1, deps.random()), policy.signal);
    } catch {
      throw new LlmCallFailure('INTERRUPTED', attempt, { cause });
    }
  }
}
