import { randomUUIDv7 } from 'node:crypto';
import { llmClient } from '@/llm/llm.js';
import type { AnalysisView } from '@/models/analysis.js';
import { analysisRepository } from '@/repositories/analysis.repository.js';
import { ConflictError, NotFoundError, UnprocessableError } from '@/shared/errors.js';
import { analysisRunner } from './analysis-runner.js';
import { logsService, type ListLogsQuery } from './logs.service.js';
import type { JobLog } from './process-analysis.js';

export interface StartedAnalysis {
  id: string;
  hasMore: boolean;
  nextCursor: string | null;
}

export const analysisService = {
  /**
   * Analyzes exactly one page of the filtered logs. Order matters: an empty page is rejected before
   * anything is written, and the single-in-flight rule is decided by the insert itself.
   */
  async start(query: ListLogsQuery, log: JobLog): Promise<StartedAnalysis> {
    // Load the page to analyze
    const page = await logsService.list(query);
    if (page.items.length === 0) {
      throw new UnprocessableError('NO_LOGS_TO_ANALYZE', 'The filters match no logs to analyze');
    }

    // Create the processing row
    const createdAt = new Date();
    const id = randomUUIDv7();
    const outcome = await analysisRepository.createProcessing(
      { id, provider: llmClient.provider, model: llmClient.model, createdAt },
      page.items.map((l) => l.id),
    );
    if (!outcome.created) {
      throw new ConflictError('ANALYSIS_IN_PROGRESS', 'Another analysis is already in progress', { id: outcome.runningId });
    }

    // Only after the row exists: the job's terminal write has something to transition.
    analysisRunner.start({ analysisId: id, logs: page.items, createdAt }, log);
    return { id, hasMore: page.hasMore, nextCursor: page.nextCursor };
  },

  async get(id: string): Promise<AnalysisView> {
    const view = await analysisRepository.findById(id);
    if (!view) throw new NotFoundError('Analysis not found');
    return view;
  },
};

export type AnalysisService = typeof analysisService;
