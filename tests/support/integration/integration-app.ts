import { vi } from 'vitest';
import { llmClient } from '@/llm/llm.js';
import { analysisRepository } from '@/repositories/analysis.repository.js';
import { analysisRunner, AnalysisRunner } from '@/services/analysis-runner.js';
import { API_KEY } from './database.js';

export const authHeaders = { 'x-api-key': API_KEY };

export interface FreshRunnerOptions {
  /** Per-attempt LLM timeout; defaults to 30 s (use a few ms with `hangUntilAborted`). */
  timeoutMs?: number;
  /** Retries after the first attempt; defaults to 0 (a single attempt). */
  maxRetries?: number;
}

/**
 * Routes the process-wide runner to a new instance with its own retry policy and an instant backoff sleep.
 * `start`, `idle` and `shutdown` of `analysisRunner` are spied to delegate, so the app under test keeps
 * calling the singleton while a test gets a runner it can shut down for good without affecting later tests.
 * Call `vi.restoreAllMocks()` afterwards to undo it.
 */
export function useFreshRunner({ timeoutMs = 30_000, maxRetries = 0 }: FreshRunnerOptions = {}): AnalysisRunner {
  const runner = new AnalysisRunner({
    repo: analysisRepository,
    llm: llmClient,
    policy: { timeoutMs, maxRetries },
    now: () => new Date(),
    retry: { sleep: () => Promise.resolve(), random: () => 0.5 },
  });
  vi.spyOn(analysisRunner, 'start').mockImplementation((job, log) => {
    runner.start(job, log);
  });
  vi.spyOn(analysisRunner, 'idle').mockImplementation(() => runner.idle());
  vi.spyOn(analysisRunner, 'shutdown').mockImplementation(() => runner.shutdown());
  return runner;
}
