import type { LlmClient } from '@/llm/llm-client.js';
import type { AnalysisView, JobLog } from '@/models/analysis.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';
import { ConflictError, NotFoundError, UnprocessableError } from '@/shared/errors.js';
import type { AnalysisRunner } from './analysis-runner.js';
import type { ListLogsQuery, LogsService } from './logs.service.js';

export interface StartedAnalysis {
  id: string;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AnalysisServiceDeps {
  logs: Pick<LogsService, 'list'>;
  analysisRepo: AnalysisRepository;
  runner: Pick<AnalysisRunner, 'start'>;
  llm: Pick<LlmClient, 'provider' | 'model'>;
  newId: () => string;
  now: () => Date;
}

export class AnalysisService {
  private readonly deps: AnalysisServiceDeps;

  constructor(deps: AnalysisServiceDeps) {
    this.deps = deps;
  }

  /**
   * Analyzes exactly one page of the filtered logs. Order matters: an empty page is rejected before
   * anything is written, and the single-in-flight rule is decided by the insert itself.
   */
  async start(query: ListLogsQuery, log: JobLog): Promise<StartedAnalysis> {
    const page = await this.deps.logs.list(query);
    if (page.items.length === 0) {
      throw new UnprocessableError('NO_LOGS_TO_ANALYZE', 'The filters match no logs to analyze');
    }

    const createdAt = this.deps.now();
    const id = this.deps.newId();
    const outcome = await this.deps.analysisRepo.createProcessing(
      { id, provider: this.deps.llm.provider, model: this.deps.llm.model, createdAt },
      page.items.map((l) => l.id),
    );
    if (!outcome.created) {
      throw new ConflictError('ANALYSIS_IN_PROGRESS', 'Another analysis is already in progress', { id: outcome.runningId });
    }

    // Only after the row exists: the job's terminal write has something to transition.
    this.deps.runner.start({ analysisId: id, logs: page.items, createdAt }, log);
    return { id, hasMore: page.hasMore, nextCursor: page.nextCursor };
  }

  async get(id: string): Promise<AnalysisView> {
    const view = await this.deps.analysisRepo.findById(id);
    if (!view) throw new NotFoundError('Analysis not found');
    return view;
  }
}
