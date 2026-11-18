import { createRuntime, type Runtime, type RuntimeDeps } from '@/composition/create-runtime.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';
import type { LlmClient } from '@/llm/llm-client.js';
import type { LogRepository } from '@/repositories/log.repository.js';
import { PrismaAnalysisRepository } from '@/repositories/prisma-analysis.repository.js';
import { PrismaLogRepository } from '@/repositories/prisma-log.repository.js';
import { PrismaServiceRepository } from '@/repositories/prisma-service.repository.js';
import { loadConfig, type Config } from '@/shared/config/load-config.js';
import type { PrismaClient } from '@/shared/db/generated/client.js';
import { API_KEY } from './database.js';

export const authHeaders = { 'x-api-key': API_KEY };

export interface IntegrationRuntimeOptions {
  prisma: PrismaClient;
  llm: LlmClient;
  /** Per-attempt LLM timeout; defaults to 30 s (use a few ms with `hangUntilAborted`). */
  timeoutMs?: number;
  /** Retries after the first attempt; defaults to 0 (a single attempt). */
  maxRetries?: number;
  /** Decorates the real Prisma analysis repository, e.g. to sabotage one write. */
  wrapAnalysisRepo?: (repo: AnalysisRepository) => AnalysisRepository;
  /** Replaces the Prisma log repository, e.g. with an instance a test later spies on. */
  logRepo?: LogRepository;
  /** Defaults to a real `SELECT 1` against `prisma`. */
  checkDatabase?: () => Promise<void>;
  /** Fixed ids and clock, to make responses reproducible. */
  newId?: () => string;
  now?: () => Date;
  /** Runs when `runtime.close()` reaches the disconnect step, so a test can observe state at that moment. */
  onDisconnect?: () => Promise<void>;
}

/**
 * The inputs of the real composition over Postgres: only the LLM is scripted and the backoff sleep
 * is instant. `disconnect` is a no-op unless `onDisconnect` is given, because the test file owns the Prisma pool.
 */
export function buildIntegrationDeps(options: IntegrationRuntimeOptions): { config: Config; deps: RuntimeDeps } {
  const { prisma, llm } = options;
  const config = loadConfig({
    DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
    LOG_LEVEL: 'silent',
    LLM_TIMEOUT_MS: String(options.timeoutMs ?? 30_000),
    LLM_MAX_RETRIES: String(options.maxRetries ?? 0),
  });
  const analysisRepo = new PrismaAnalysisRepository(prisma);
  const deps: RuntimeDeps = {
    serviceRepo: new PrismaServiceRepository(prisma),
    logRepo: options.logRepo ?? new PrismaLogRepository(prisma),
    analysisRepo: options.wrapAnalysisRepo?.(analysisRepo) ?? analysisRepo,
    llm,
    checkDatabase:
      options.checkDatabase ??
      (async () => {
        await prisma.$queryRaw`SELECT 1`;
      }),
    disconnect: options.onDisconnect ?? (() => Promise.resolve()),
    retry: { sleep: () => Promise.resolve(), random: () => 0.5 },
    ...(options.newId && { newId: options.newId }),
    ...(options.now && { now: options.now }),
  };
  return { config, deps };
}

/** The real composition (`createRuntime`) over Postgres, without listening. */
export function buildIntegrationRuntime(options: IntegrationRuntimeOptions): Runtime {
  const { config, deps } = buildIntegrationDeps(options);
  return createRuntime(config, deps);
}
