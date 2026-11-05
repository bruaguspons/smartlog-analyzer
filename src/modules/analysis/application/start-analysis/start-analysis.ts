import { listLogs } from '@/modules/logs/application/list-logs/list-logs.js';
import type { ListLogsQuery } from '@/modules/logs/application/list-logs/list-logs.types.js';
import type { JobLog } from '@/modules/analysis/domain/job-log.types.js';
import { ConflictError } from '@/shared/errors/conflict-error.js';
import { UnprocessableError } from '@/shared/errors/unprocessable-error.js';
import type { StartAnalysisDeps, StartedAnalysis } from './start-analysis.types.js';

/**
 * Analyzes exactly one page of the filtered logs. Order matters: an empty page is rejected before
 * anything is written, and the single-in-flight rule is decided by the insert itself.
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
