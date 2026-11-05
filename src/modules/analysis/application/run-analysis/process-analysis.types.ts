import type { Log } from '@/modules/logs/domain/log.types.js';
import type { TokenUsage } from '@/modules/analysis/domain/analysis.types.js';
import type { AnalysisRepository } from '@/modules/analysis/domain/analysis-repository.types.js';
import type { LlmClient } from '@/modules/analysis/domain/llm-client.types.js';
import type { RetryDeps } from '@/modules/analysis/application/run-analysis/retry/retry.types.js';

export interface AnalysisJob {
  analysisId: string;
  logs: readonly Log[];
  createdAt: Date;
}

export interface ProcessDeps {
  repo: AnalysisRepository;
  llm: LlmClient;
  policy: { timeoutMs: number; maxRetries: number };
  now: () => Date;
  /** Test seam: deterministic time and randomness for the retry policy. */
  retry?: Partial<RetryDeps>;
}

/** What the provider returned before processing broke down; kept so the last-resort write can still persist it. */
export interface PartialOutcome {
  rawResponse: string | null;
  usage: TokenUsage | null;
}
