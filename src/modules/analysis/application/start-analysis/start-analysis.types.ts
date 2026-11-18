import type { LogRepository } from '@/repositories/log.repository.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';
import type { LlmClient } from '@/modules/analysis/domain/llm-client.types.js';
import type { AnalysisRunner } from '@/modules/analysis/application/run-analysis/analysis-runner.js';

export interface StartAnalysisDeps {
  logRepo: LogRepository;
  analysisRepo: AnalysisRepository;
  runner: Pick<AnalysisRunner, 'start'>;
  llm: Pick<LlmClient, 'provider' | 'model'>;
  newId: () => string;
  now: () => Date;
}

export interface StartedAnalysis {
  id: string;
  hasMore: boolean;
  nextCursor: string | null;
}
