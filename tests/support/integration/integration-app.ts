import type { Runtime } from '@/composition/runtime.types.js';
import { createRuntime } from '@/composition/create-runtime.js';
import type { AnalysisRepository } from '@/modules/analysis/domain/analysis-repository.types.js';
import type { LlmClient } from '@/modules/analysis/domain/llm-client.types.js';
import { PrismaAnalysisRepository } from '@/modules/analysis/infrastructure/prisma-analysis-repository/prisma-analysis-repository.js';
import { PrismaLogRepository } from '@/modules/logs/infrastructure/prisma-log-repository/prisma-log-repository.js';
import { PrismaServiceRepository } from '@/modules/services/infrastructure/prisma-service-repository.js';
import { loadConfig } from '@/shared/config/load-config.js';
import type { PrismaClient } from '@/shared/db/generated/client.js';

/** The API key of the single service `resetDatabase` creates. */
export const API_KEY = 'key-1';
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
  /** Runs when the app's `onClose` reaches the disconnect step, so a test can observe state at that moment. */
  onDisconnect?: () => Promise<void>;
}

/**
 * The real composition (`createRuntime`) over Postgres: only the LLM is scripted and the backoff sleep
 * is instant. `disconnect` is a no-op unless `onDisconnect` is given, because the test file owns the Prisma pool.
 */
export function buildIntegrationRuntime(options: IntegrationRuntimeOptions): Runtime {
  const { prisma, llm } = options;
  const config = loadConfig({
    DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
    LOG_LEVEL: 'silent',
    LLM_TIMEOUT_MS: String(options.timeoutMs ?? 30_000),
    LLM_MAX_RETRIES: String(options.maxRetries ?? 0),
  });
  const analysisRepo = new PrismaAnalysisRepository(prisma);
  return createRuntime(config, {
    serviceRepo: new PrismaServiceRepository(prisma),
    logRepo: new PrismaLogRepository(prisma),
    analysisRepo: options.wrapAnalysisRepo?.(analysisRepo) ?? analysisRepo,
    llm,
    checkDatabase: () => Promise.resolve(),
    disconnect: options.onDisconnect ?? (() => Promise.resolve()),
    retry: { sleep: () => Promise.resolve(), random: () => 0.5 },
  });
}

/** Empties every table and recreates the single active service `key-1` (id 1). */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE analyses, logs, services RESTART IDENTITY CASCADE`;
  await prisma.service.create({ data: { name: 'svc', apiKey: API_KEY } });
}
