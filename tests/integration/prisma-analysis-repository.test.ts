import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { PrismaAnalysisRepository } from '../../src/modules/analysis/infrastructure/prisma-analysis-repository.js';
import { createPrismaClient } from '../../src/shared/db/prisma-client.js';
import { analysisId, logId, runAnalysisRepositoryContract } from '../shared/analysis-repository-contract.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const repository = new PrismaAnalysisRepository(prisma);

async function resetDatabase(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE analyses, logs, services RESTART IDENTITY CASCADE`;
  await prisma.service.create({ data: { name: 'svc', apiKey: 'key-1' } });
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaAnalysisRepository', () => {
  it('rolls the analysis back when one of its logs does not exist (atomic create)', async () => {
    await resetDatabase();

    await expect(
      repository.createProcessing({ id: analysisId(1), provider: 'mock', model: 'mock', createdAt: new Date() }, [logId(1)]),
    ).rejects.toThrow();

    expect(await prisma.analysis.count()).toBe(0);
  });
});

runAnalysisRepositoryContract(async () => {
  await resetDatabase();
  return {
    repo: repository,
    seedLogs: async (ids) => {
      await prisma.log.createMany({
        data: ids.map((id) => ({
          id,
          serviceId: 1,
          level: 'ERROR' as const,
          timestamp: new Date('2026-11-04T09:00:00.000Z'),
          message: `log ${id}`,
        })),
      });
    },
  };
});
