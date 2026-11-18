import type { FastifyInstance } from 'fastify';
import type { AnalysisRunner } from '@/modules/analysis/application/run-analysis/analysis-runner.js';
import type { RetryDeps } from '@/modules/analysis/application/run-analysis/retry/retry.types.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';
import type { LlmClient } from '@/modules/analysis/domain/llm-client.types.js';
import type { LogRepository } from '@/repositories/log.repository.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import type { DatabaseCheck } from '@/shared/http/health/health.types.js';

/** Everything the runtime needs from the outside world; tests inject in-memory fakes. */
export interface RuntimeDeps {
  serviceRepo: ServiceRepository;
  logRepo: LogRepository;
  analysisRepo: AnalysisRepository;
  llm: LlmClient;
  checkDatabase: DatabaseCheck;
  /** Releases the database pool; always runs after the analysis runner has shut down. */
  disconnect: () => Promise<void>;
  retry?: Partial<RetryDeps>;
  newId?: () => string;
  now?: () => Date;
  logStream?: { write(msg: string): void };
}

export interface Runtime {
  app: FastifyInstance;
  runner: AnalysisRunner;
  /** Recovers leftover PROCESSING rows, then listens (in that order). */
  start(): Promise<void>;
}
