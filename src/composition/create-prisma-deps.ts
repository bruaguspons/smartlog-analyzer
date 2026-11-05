import { createLlmClient } from '@/modules/analysis/infrastructure/llm/create-llm-client.js';
import { PrismaAnalysisRepository } from '@/modules/analysis/infrastructure/prisma-analysis-repository/prisma-analysis-repository.js';
import { PrismaLogRepository } from '@/modules/logs/infrastructure/prisma-log-repository/prisma-log-repository.js';
import { PrismaServiceRepository } from '@/modules/services/infrastructure/prisma-service-repository.js';
import type { Config } from '@/shared/config/config.types.js';
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
