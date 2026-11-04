import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Log } from '../../src/modules/logs/domain/log.js';
import { PrismaLogRepository } from '../../src/modules/logs/infrastructure/prisma-log-repository.js';
import { createPrismaClient } from '../../src/shared/db/prisma-client.js';
import { runLogListContract } from '../shared/log-repository-list-contract.js';
import { runLogStatsContract } from '../shared/log-repository-stats-contract.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const repository = new PrismaLogRepository(prisma);

const ID = '0192f1c0-0000-7000-8000-000000000001';

function makeLog(overrides: Partial<Log> = {}): Log {
  return {
    id: ID,
    serviceId: 1,
    level: 'ERROR',
    timestamp: new Date('2026-11-03T10:00:00.123Z'),
    message: 'boom',
    traceId: 'trace-1',
    metadata: { a: { b: [1, 2] }, ok: true },
    ...overrides,
  };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE logs, services RESTART IDENTITY CASCADE`;
  await prisma.service.create({ data: { name: 'svc', apiKey: 'key-1' } });
});

describe('PrismaLogRepository', () => {
  it('S24: round-trips every field, keeping milliseconds and nested metadata', async () => {
    const log = makeLog();

    const created = await repository.create(log);
    const stored = await prisma.log.findUniqueOrThrow({ where: { id: ID } });

    expect(created).toEqual(log);
    expect(stored.timestamp.toISOString()).toBe('2026-11-03T10:00:00.123Z');
    expect(stored.metadata).toEqual(log.metadata);
    expect(stored.serviceId).toBe(1);
    expect(stored.level).toBe('ERROR');
  });

  it('S25: rejects an unknown serviceId with a foreign key violation', async () => {
    await expect(repository.create(makeLog({ serviceId: 999 }))).rejects.toThrow();
    expect(await prisma.log.count()).toBe(0);
  });

  it('S26: stores SQL NULL for absent traceId and metadata', async () => {
    await repository.create(makeLog({ traceId: null, metadata: null }));

    const rows = await prisma.$queryRaw<{ trace_id: string | null; metadata: unknown }[]>`
      SELECT trace_id, metadata FROM logs WHERE id = ${ID}::uuid`;

    expect(rows).toEqual([{ trace_id: null, metadata: null }]);
  });
});

const makeRepo = async () => {
  await prisma.$executeRaw`TRUNCATE logs, services RESTART IDENTITY CASCADE`;
  await prisma.service.create({ data: { name: 'svc-1', apiKey: 'key-1' } });
  await prisma.service.create({ data: { name: 'svc-2', apiKey: 'key-2' } });
  return {
    repo: repository,
    seed: async (logs: Log[]) => {
      for (const log of logs) await repository.create(log);
    },
  };
};

runLogListContract(makeRepo);
runLogStatsContract(makeRepo);
