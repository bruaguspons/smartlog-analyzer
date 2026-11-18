import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Log, LogFilters } from '@/models/log.js';
import type { LogCountGroup, LogRepository } from '@/repositories/log.repository.js';
import { PrismaLogRepository } from '@/repositories/prisma-log.repository.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { makeLog } from '@tests/support/fixtures.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const repository = new PrismaLogRepository(prisma);

const ID = '0192f1c0-0000-7000-8000-000000000001';

function makeStoredLog(overrides: Partial<Log> = {}): Log {
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

const uuid = (n: number) => `0192f1c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (iso: string) => new Date(iso);
const T = (s: number) => at(`2026-11-03T10:00:${String(s).padStart(2, '0')}.000Z`);
const makeListLog = (n: number, overrides: Partial<Log> = {}): Log => makeLog(n, { id: uuid(n), ...overrides });
const g = (serviceId: number, level: LogCountGroup['level'], count: number): LogCountGroup => ({
  serviceId,
  level,
  count,
});
/** Group order is unspecified by the repository: compare sorted. */
const sorted = (groups: LogCountGroup[]) =>
  [...groups].sort((a, b) => a.serviceId - b.serviceId || a.level.localeCompare(b.level));

/** Empties the logs, creates services 1 and 2 and returns the repository with a seeding helper. */
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
  it('round-trips every field, keeping milliseconds and nested metadata', async () => {
    const log = makeStoredLog();

    const created = await repository.create(log);
    const stored = await prisma.log.findUniqueOrThrow({ where: { id: ID } });

    expect(created).toEqual(log);
    expect(stored.timestamp.toISOString()).toBe('2026-11-03T10:00:00.123Z');
    expect(stored.metadata).toEqual(log.metadata);
    expect(stored.serviceId).toBe(1);
    expect(stored.level).toBe('ERROR');
  });

  it('rejects an unknown serviceId with a foreign key violation', async () => {
    await expect(repository.create(makeStoredLog({ serviceId: 999 }))).rejects.toThrow(/foreign key/i);
    expect(await prisma.log.count()).toBe(0);
  });

  it('stores SQL NULL for absent traceId and metadata', async () => {
    await repository.create(makeStoredLog({ traceId: null, metadata: null }));

    const rows = await prisma.$queryRaw<{ trace_id: string | null; metadata: unknown }[]>`
      SELECT trace_id, metadata FROM logs WHERE id = ${ID}::uuid`;

    expect(rows).toEqual([{ trace_id: null, metadata: null }]);
  });
});


describe('LogRepository.list', () => {
  let repo: LogRepository;
  let seed: (logs: Log[]) => Promise<void>;
  const ids = async (filters = {}, page: { take: number; cursor?: { timestamp: Date; id: string } } = { take: 100 }) =>
    (await repo.list(filters, page)).map((l) => l.id);

  beforeEach(async () => {
    ({ repo, seed } = await makeRepo());
  });

  it('returns nothing for an empty store', async () => {
    expect(await ids()).toEqual([]);
  });

  it('filters by serviceId and sees every service when unfiltered', async () => {
    await seed([makeListLog(1), makeListLog(2, { serviceId: 2 })]);
    expect(await ids({ serviceId: 2 })).toEqual([uuid(2)]);
    expect(await ids()).toEqual([uuid(2), uuid(1)]);
  });

  it('filters by any of the listed levels', async () => {
    await seed([
      makeListLog(1, { level: 'ERROR' }),
      makeListLog(2, { level: 'FATAL' }),
      makeListLog(3, { level: 'INFO' }),
    ]);
    expect(await ids({ level: ['ERROR', 'FATAL'] })).toEqual([uuid(2), uuid(1)]);
    expect(await ids({ level: ['ERROR'] })).toEqual([uuid(1)]);
  });

  it('from/to are inclusive at the exact bounds and work as open ranges', async () => {
    await seed([makeListLog(1), makeListLog(2), makeListLog(3), makeListLog(4)]);
    expect(await ids({ from: T(2), to: T(3) })).toEqual([uuid(3), uuid(2)]);
    expect(await ids({ from: T(3) })).toEqual([uuid(4), uuid(3)]);
    expect(await ids({ to: T(2) })).toEqual([uuid(2), uuid(1)]);
  });

  it('traceId is an exact, case-sensitive match and never matches null', async () => {
    await seed([
      makeListLog(1, { traceId: 'abc' }),
      makeListLog(2, { traceId: 'abcd' }),
      makeListLog(3, { traceId: 'ABC' }),
      makeListLog(4),
    ]);
    expect(await ids({ traceId: 'abc' })).toEqual([uuid(1)]);
  });

  it('search is a case-insensitive substring', async () => {
    await seed([makeListLog(1, { message: 'Connection timeout' }), makeListLog(2, { message: 'ok' })]);
    expect(await ids({ search: 'TIMEOUT' })).toEqual([uuid(1)]);
  });

  it.each([
    ['100%', ['100% done'], ['1000 done', '100 done']],
    ['a_c', ['a_c'], ['abc']],
    ['a\\b', ['a\\b'], ['ab', 'a/b']],
  ])('search treats %j literally', async (search, hits, misses) => {
    await seed([...hits, ...misses].map((message, i) => makeListLog(i + 1, { message })));
    const found = (await repo.list({ search }, { take: 100 })).map((l) => l.message);
    expect(found.sort()).toEqual([...hits].sort());
  });

  it('combines every filter with AND', async () => {
    await seed([
      makeListLog(1, { serviceId: 1, level: 'ERROR', traceId: 't', message: 'x here' }),
      makeListLog(2, { serviceId: 2, level: 'ERROR', traceId: 't', message: 'x here' }),
      makeListLog(3, { serviceId: 1, level: 'INFO', traceId: 't', message: 'x here' }),
      makeListLog(4, { serviceId: 1, level: 'ERROR', traceId: 'u', message: 'x here' }),
      makeListLog(5, { serviceId: 1, level: 'ERROR', traceId: 't', message: 'nope' }),
    ]);
    const filters = { serviceId: 1, level: ['ERROR' as const], from: T(1), to: T(5), traceId: 't', search: 'x' };
    expect(await ids(filters)).toEqual([uuid(1)]);
  });

  it('orders by timestamp DESC then id DESC and honors take', async () => {
    const same = T(30);
    await seed([
      makeListLog(1, { timestamp: same }),
      makeListLog(3, { timestamp: same }),
      makeListLog(2, { timestamp: same }),
      makeListLog(4, { timestamp: T(10) }),
    ]);
    expect(await ids()).toEqual([uuid(3), uuid(2), uuid(1), uuid(4)]);
    expect(await ids({}, { take: 2 })).toEqual([uuid(3), uuid(2)]);
  });

  it('cursor is exclusive and pages neither overlap nor skip across timestamp ties', async () => {
    const same = T(30);
    await seed([
      makeListLog(1, { timestamp: same }),
      makeListLog(2, { timestamp: same }),
      makeListLog(3, { timestamp: same }),
      makeListLog(4, { timestamp: T(10) }),
      makeListLog(5, { timestamp: T(40) }),
    ]);
    const all = await ids();
    const walked: string[] = [];
    let cursor: { timestamp: Date; id: string } | undefined;
    for (;;) {
      const page = await repo.list({}, { take: 2, ...(cursor && { cursor }) });
      walked.push(...page.map((l) => l.id));
      const last = page.at(-1);
      if (page.length < 2 || !last) break;
      cursor = { timestamp: last.timestamp, id: last.id };
    }
    expect(walked).toEqual(all);
    expect(new Set(walked).size).toBe(5);
  });

  it('cursor and filters apply together', async () => {
    await seed([
      makeListLog(1, { level: 'ERROR' }),
      makeListLog(2, { level: 'INFO' }),
      makeListLog(3, { level: 'ERROR' }),
    ]);
    const page = await repo.list({ level: ['ERROR'] }, { take: 10, cursor: { timestamp: T(3), id: uuid(3) } });
    expect(page.map((l) => l.id)).toEqual([uuid(1)]);
  });
});

describe('LogRepository.countByServiceAndLevel', () => {
  let repo: LogRepository;
  let seed: (logs: Log[]) => Promise<void>;
  const count = async (filters: LogFilters = {}) => sorted(await repo.countByServiceAndLevel(filters));

  beforeEach(async () => {
    ({ repo, seed } = await makeRepo());
  });

  it('returns no groups for an empty store', async () => {
    expect(await count()).toEqual([]);
  });

  it('counts per (service, level) across services and emits no zero groups', async () => {
    await seed([
      makeListLog(1, { serviceId: 1, level: 'ERROR' }),
      makeListLog(2, { serviceId: 1, level: 'ERROR' }),
      makeListLog(3, { serviceId: 1, level: 'INFO' }),
      makeListLog(4, { serviceId: 2, level: 'ERROR' }),
    ]);
    expect(await count()).toEqual([g(1, 'ERROR', 2), g(1, 'INFO', 1), g(2, 'ERROR', 1)]);
  });

  it('filters by serviceId and by any of the listed levels', async () => {
    await seed([
      makeListLog(1, { serviceId: 1, level: 'ERROR' }),
      makeListLog(2, { serviceId: 2, level: 'FATAL' }),
      makeListLog(3, { serviceId: 2, level: 'INFO' }),
    ]);
    expect(await count({ serviceId: 2 })).toEqual([g(2, 'FATAL', 1), g(2, 'INFO', 1)]);
    expect(await count({ level: ['ERROR', 'FATAL'] })).toEqual([g(1, 'ERROR', 1), g(2, 'FATAL', 1)]);
  });

  it('from/to are inclusive at the exact bounds and work as open ranges', async () => {
    await seed([makeListLog(1), makeListLog(2), makeListLog(3), makeListLog(4)]);
    expect(await count({ from: T(2), to: T(3) })).toEqual([g(1, 'INFO', 2)]);
    expect(await count({ from: T(4) })).toEqual([g(1, 'INFO', 1)]);
    expect(await count({ to: T(1) })).toEqual([g(1, 'INFO', 1)]);
  });

  it('traceId is an exact, case-sensitive match and never matches null', async () => {
    await seed([
      makeListLog(1, { traceId: 'abc' }),
      makeListLog(2, { traceId: 'abcd' }),
      makeListLog(3, { traceId: 'ABC' }),
      makeListLog(4),
    ]);
    expect(await count({ traceId: 'abc' })).toEqual([g(1, 'INFO', 1)]);
  });

  it.each([
    ['100%', ['100% done'], ['1000 done', '100 done']],
    ['a_c', ['a_c'], ['abc']],
    ['a\\b', ['a\\b'], ['ab', 'a/b']],
  ])('search treats %j literally', async (search, hits, misses) => {
    await seed([...hits, ...misses].map((message, i) => makeListLog(i + 1, { message })));
    expect(await count({ search })).toEqual([g(1, 'INFO', hits.length)]);
  });

  it('combines every filter with AND', async () => {
    await seed([
      makeListLog(1, { serviceId: 1, level: 'ERROR', traceId: 't', message: 'x here' }),
      makeListLog(2, { serviceId: 2, level: 'ERROR', traceId: 't', message: 'x here' }),
      makeListLog(3, { serviceId: 1, level: 'INFO', traceId: 't', message: 'x here' }),
      makeListLog(4, { serviceId: 1, level: 'ERROR', traceId: 'u', message: 'x here' }),
      makeListLog(5, { serviceId: 1, level: 'ERROR', traceId: 't', message: 'nope' }),
    ]);
    const filters = { serviceId: 1, level: ['ERROR' as const], from: T(1), to: T(5), traceId: 't', search: 'x' };
    expect(await count(filters)).toEqual([g(1, 'ERROR', 1)]);
  });
});
