import { createLlmClient } from '@/llm/create-llm-client.js';
import { PrismaAnalysisRepository } from '@/repositories/prisma-analysis.repository.js';
import { PrismaLogRepository } from '@/repositories/prisma-log.repository.js';
import { PrismaServiceRepository } from '@/repositories/prisma-service.repository.js';
import type { Config } from '@/shared/config/load-config.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import type { RuntimeDeps } from './runtime.types.js';

/** Production dependencies: Prisma repositories and the configured LLM client. */
export function createPrismaDeps(config: Config): RuntimeDeps {
  const prisma = createPrismaClient(config.databaseUrl);
  return {
    serviceRepo: new PrismaServiceRepository(prisma),
    logRepo: new PrismaLogRepository(prisma),
    analysisRepo: new PrismaAnalysisRepository(prisma),
    llm: createLlmClient(config.llm),
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    disconnect: () => prisma.$disconnect(),
  };
}
