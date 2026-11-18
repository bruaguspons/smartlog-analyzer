import type { Log } from '@/models/log.js';
import type { TokenUsage } from '@/models/analysis.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';
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
