import { listLogs, type ListLogsQuery } from '../../logs/application/list-logs.js';
import type { LogRepository } from '../../logs/domain/log-repository.js';
import { ConflictError, UnprocessableError } from '../../../shared/errors/app-error.js';
import type { AnalysisRepository } from '../domain/analysis-repository.js';
import type { LlmClient } from '../domain/llm-client.js';
import type { AnalysisRunner } from './analysis-runner.js';
import type { JobLog } from './process-analysis.js';

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

/**
 * Analyzes exactly one page of the filtered logs. Order matters (ARCHITECTURE 3.2): an empty page is
 * rejected before anything is written, and the single-in-flight rule (D15) is decided by the insert itself.
 */
export async function startAnalysis(query: ListLogsQuery, log: JobLog, deps: StartAnalysisDeps): Promise<StartedAnalysis> {
  const page = await listLogs(query, { repo: deps.logRepo });
  if (page.items.length === 0) {
    throw new UnprocessableError('NO_LOGS_TO_ANALYZE', 'The filters match no logs to analyze');
  }

  const createdAt = deps.now();
  const id = deps.newId();
  const outcome = await deps.analysisRepo.createProcessing(
    { id, provider: deps.llm.provider, model: deps.llm.model, createdAt },
    page.items.map((l) => l.id),
  );
  if (!outcome.created) {
    throw new ConflictError('ANALYSIS_IN_PROGRESS', 'Another analysis is already in progress', { id: outcome.runningId });
  }

  // Only after the row exists: the job's terminal write has something to transition.
  deps.runner.start({ analysisId: id, logs: page.items, createdAt }, log);
  return { id, hasMore: page.hasMore, nextCursor: page.nextCursor };
}
