import { LlmError } from '@/modules/analysis/domain/llm-error.js';
import { backoffDelayMs } from './backoff-delay-ms.js';
import { defaultRetryDeps } from './default-retry-deps.js';
import { LlmCallFailure } from './llm-call-failure.js';
import { CODE_BY_KIND } from './retry.const.js';
import type { FailureKind, RetryDeps, RetryPolicy } from './retry.types.js';

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
  const deps: RetryDeps = { ...defaultRetryDeps, ...overrides };
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
