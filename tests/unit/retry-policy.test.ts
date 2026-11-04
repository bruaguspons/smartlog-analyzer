import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmError, type LlmErrorKind } from '../../src/modules/analysis/domain/llm-client.js';
import {
  LlmCallFailure,
  backoffDelayMs,
  callWithRetry,
  type RetryDeps,
} from '../../src/modules/analysis/application/retry-policy.js';

const TIMEOUT_MS = 1000;

/** Injected sleep that records the requested delays and resolves immediately. */
function recordingDeps(random = () => 0.5) {
  const delays: number[] = [];
  const scheduled: number[] = [];
  const deps: RetryDeps = {
    random,
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    schedule: (fn, ms) => {
      scheduled.push(ms);
      const timer = setTimeout(fn, ms);
      return () => {
        clearTimeout(timer);
      };
    },
  };
  return { deps, delays, scheduled };
}

const policy = (maxRetries: number, signal = new AbortController().signal) => ({
  timeoutMs: TIMEOUT_MS,
  maxRetries,
  signal,
});

/** Settles to the rejection (or resolution) so unhandled rejections never leak while timers advance. */
const settle = <T>(promise: Promise<T>) =>
  promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('callWithRetry', () => {
  it('returns the first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const { deps } = recordingDeps();
    await expect(callWithRetry(fn, policy(3), deps)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('times out on every attempt -> 4 attempts with max 3 and LLM_TIMEOUT', async () => {
    const fn = vi.fn(() => new Promise<string>(() => undefined)); // ignores the signal and never settles
    const { deps, delays, scheduled } = recordingDeps();
    const outcome = settle(callWithRetry(fn, policy(3), deps));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 10);
    const result = await outcome;
    expect(fn).toHaveBeenCalledTimes(4);
    expect(delays).toHaveLength(3);
    expect(scheduled).toEqual([TIMEOUT_MS, TIMEOUT_MS, TIMEOUT_MS, TIMEOUT_MS]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(LlmCallFailure);
    expect(result.error).toMatchObject({ code: 'LLM_TIMEOUT', attempts: 4 });
  });

  it('aborts the attempt signal when the attempt times out', async () => {
    const signals: AbortSignal[] = [];
    const fn = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });
    const { deps } = recordingDeps();
    const outcome = settle(callWithRetry(fn, policy(0), deps));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    const result = await outcome;
    expect(signals[0]?.aborted).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'LLM_TIMEOUT', attempts: 1 });
  });

  it('timeout then success -> resolves after 2 attempts', async () => {
    let calls = 0;
    const fn = vi.fn(() => {
      calls += 1;
      return calls === 1 ? new Promise<string>(() => undefined) : Promise.resolve('ok');
    });
    const { deps, scheduled } = recordingDeps();
    const outcome = settle(callWithRetry(fn, policy(3), deps));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS * 2);
    expect(await outcome).toEqual({ ok: true, value: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(scheduled).toEqual([TIMEOUT_MS, TIMEOUT_MS]);
  });

  it('with default deps the attempt is not aborted at timeoutMs-1 and is aborted at timeoutMs', async () => {
    let attemptSignal: AbortSignal | undefined;
    const fn = vi.fn((signal: AbortSignal) => {
      attemptSignal = signal;
      return new Promise<string>(() => undefined);
    });
    const outcome = settle(callWithRetry(fn, policy(0), { random: () => 0.5 }));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(attemptSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(attemptSignal?.aborted).toBe(true);
    const result = await outcome;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'LLM_TIMEOUT', attempts: 1 });
  });

  it('with the default sleep, 503 then success resolves after the backoff elapses', async () => {
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new LlmError('unavailable', 'boom'))
      .mockResolvedValueOnce('ok');
    const outcome = settle(callWithRetry(fn, policy(3), { random: () => 0.5 }));
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual({ ok: true, value: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each<[LlmErrorKind, number]>([
    ['rejected', 1],
    ['rate_limited', 3],
    ['unavailable', 3],
    ['network', 3],
  ])('%s failures make %i attempt(s) with maxRetries=2', async (kind, attempts) => {
    const { deps } = recordingDeps();
    const fn = vi.fn().mockRejectedValue(new LlmError(kind, 'boom'));
    await settle(callWithRetry(fn, policy(2), deps));
    expect(fn).toHaveBeenCalledTimes(attempts);
  });

  it('rate limited uses the same schedule as unavailable and ends in LLM_RATE_LIMITED', async () => {
    const run = async (kind: LlmErrorKind) => {
      const { deps, delays } = recordingDeps(() => 0.3);
      const fn = vi.fn().mockRejectedValue(new LlmError(kind, 'boom'));
      const result = await settle(callWithRetry(fn, policy(3), deps));
      return { delays, fn, result };
    };
    const rate = await run('rate_limited');
    const unavailable = await run('unavailable');
    expect(rate.delays).toEqual(unavailable.delays);
    expect(rate.fn).toHaveBeenCalledTimes(4);
    expect(rate.result.ok).toBe(false);
    if (!rate.result.ok) expect(rate.result.error).toMatchObject({ code: 'LLM_RATE_LIMITED', attempts: 4 });
  });

  it.each<[LlmErrorKind]>([['unavailable'], ['network']])('%s exhausted -> LLM_UNAVAILABLE', async (kind) => {
    const { deps } = recordingDeps();
    const fn = vi.fn().mockRejectedValue(new LlmError(kind, 'boom'));
    const result = await settle(callWithRetry(fn, policy(2), deps));
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'LLM_UNAVAILABLE', attempts: 3 });
  });

  it('rejected -> 1 attempt and LLM_REQUEST_REJECTED', async () => {
    const { deps, delays } = recordingDeps();
    const fn = vi.fn().mockRejectedValue(new LlmError('rejected', 'forbidden'));
    const result = await settle(callWithRetry(fn, policy(3), deps));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'LLM_REQUEST_REJECTED', attempts: 1 });
  });

  it('maxRetries=0 makes a single attempt', async () => {
    const { deps } = recordingDeps();
    const fn = vi.fn().mockRejectedValue(new LlmError('unavailable', 'boom'));
    const result = await settle(callWithRetry(fn, policy(0), deps));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it('failure message and cause never leak into the message text', async () => {
    const { deps } = recordingDeps();
    const fn = vi.fn().mockRejectedValue(new LlmError('rejected', 'key=SECRET-KEY'));
    const result = await settle(callWithRetry(fn, policy(0), deps));
    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as Error).message).not.toContain('SECRET-KEY');
  });

  it('does not retry unexpected (non-LLM) errors and rethrows them as is', async () => {
    const { deps } = recordingDeps();
    const boom = new TypeError('bug');
    const fn = vi.fn().mockRejectedValue(boom);
    const result = await settle(callWithRetry(fn, policy(3), deps));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, error: boom });
  });

  it('backoff delays stay within 1000*2^n*(0.75..1.25)', async () => {
    for (const random of [0, 0.5, 0.999999]) {
      const { deps, delays } = recordingDeps(() => random);
      const fn = vi.fn().mockRejectedValue(new LlmError('unavailable', 'boom'));
      await settle(callWithRetry(fn, policy(3), deps));
      expect(delays).toHaveLength(3);
      delays.forEach((delay, n) => {
        const base = 1000 * 2 ** n;
        expect(delay).toBeGreaterThanOrEqual(base * 0.75);
        expect(delay).toBeLessThanOrEqual(base * 1.25);
      });
    }
  });

  it('run abort during an attempt cancels it and does not retry', async () => {
    const run = new AbortController();
    let attemptSignal: AbortSignal | undefined;
    const fn = vi.fn((signal: AbortSignal) => {
      attemptSignal = signal;
      return new Promise<string>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });
    const { deps } = recordingDeps();
    const outcome = settle(callWithRetry(fn, policy(3, run.signal), deps));
    await vi.advanceTimersByTimeAsync(10);
    run.abort();
    const result = await outcome;
    expect(attemptSignal?.aborted).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'INTERRUPTED', attempts: 1 });
  });

  it('run abort during backoff stops without another attempt', async () => {
    const run = new AbortController();
    const fn = vi.fn().mockRejectedValue(new LlmError('unavailable', 'boom'));
    // Real default sleep: it must wake up on abort instead of waiting for the delay.
    const outcome = settle(callWithRetry(fn, policy(3, run.signal), { random: () => 0.5 }));
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(1);
    run.abort();
    const result = await outcome;
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'INTERRUPTED' });
  });

  it('does not call the client when the run is already aborted', async () => {
    const run = new AbortController();
    run.abort();
    const fn = vi.fn().mockResolvedValue('ok');
    const { deps } = recordingDeps();
    const result = await settle(callWithRetry(fn, policy(3, run.signal), deps));
    expect(fn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: 'INTERRUPTED', attempts: 0 });
  });
});

describe('backoffDelayMs', () => {
  it('stays within +-25% of the doubling base for any random in [0, 1]', () => {
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      for (let n = 0; n < 5; n += 1) {
        const base = 1000 * 2 ** n;
        const delay = backoffDelayMs(n, random);
        expect(delay).toBeGreaterThanOrEqual(base * 0.75);
        expect(delay).toBeLessThanOrEqual(base * 1.25);
      }
    }
  });

  it('grows with the retry index for a fixed random and with random for a fixed index', () => {
    for (let n = 0; n < 4; n += 1) {
      expect(backoffDelayMs(n + 1, 0.5)).toBeGreaterThan(backoffDelayMs(n, 0.5));
      expect(backoffDelayMs(n, 0.9)).toBeGreaterThan(backoffDelayMs(n, 0.1));
    }
  });
});
