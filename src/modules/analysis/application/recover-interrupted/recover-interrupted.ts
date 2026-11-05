import type { AnalysisRepository } from '@/modules/analysis/domain/analysis-repository.types.js';
import type { JobLog } from '@/modules/analysis/domain/job-log.types.js';

/**
 * Startup recovery: no job survives a restart, so any PROCESSING row is a leftover of a dead process.
 * Closing them before the server listens is what lets the next POST pass the single-in-flight index.
 */
export async function recoverInterrupted(repo: AnalysisRepository, log: JobLog): Promise<string[]> {
  const ids = await repo.failAllProcessing({
    errorCode: 'INTERRUPTED',
    errorMessage: 'Analysis interrupted by a server restart',
  });
  if (ids.length > 0) log.warn({ analysisIds: ids }, 'marked leftover PROCESSING analyses as INTERRUPTED');
  return ids;
}
