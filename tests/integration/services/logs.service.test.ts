import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { logRepository as logRepo } from '@/repositories/log.repository.js';
import { serviceRepository as serviceRepo } from '@/repositories/service.repository.js';
import { logsService as service } from '@/services/logs.service.js';
import { decodeCursor, encodeCursor } from '@/shared/cursor.js';
import { prisma } from '@/shared/db/prisma.js';
import { logId, makeLog, makeService } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabase } from '@tests/support/integration/database.js';

// Every generated id is `logId(900)`.
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUIDv7: () => '0192f1c0-bbbb-7000-8000-000000000900',
}));

const base = { serviceId: 1, level: 'INFO', timestamp: new Date('2026-11-03T10:00:00Z'), message: 'hi' } as const;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
  await prisma.service.createMany({ data: [makeService(1), makeService(2), makeService(3, { isActive: false })] });
});

describe('LogsService.ingest', () => {
  it('generates the id and takes the serviceId from the command, and stores the row', async () => {
    const log = await service.ingest(base);

    expect(log.id).toBe(logId(900));
    expect(log.serviceId).toBe(1);
    expect(await prisma.log.findUniqueOrThrow({ where: { id: log.id } })).toMatchObject({ serviceId: 1, message: 'hi' });
  });

  it('normalizes absent optionals to null', async () => {
    const log = await service.ingest(base);

    expect(log.traceId).toBeNull();
    expect(log.metadata).toBeNull();
  });

  it('keeps provided optionals', async () => {
    const log = await service.ingest({ ...base, traceId: 't', metadata: { a: 1 } });

    expect(log).toMatchObject({ traceId: 't', metadata: { a: 1 } });
  });

  it('calls repo.create exactly once', async () => {
    const create = vi.spyOn(logRepo, 'create');

    await service.ingest(base);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propagates repository errors', async () => {
    vi.spyOn(logRepo, 'create').mockRejectedValue(new Error('db down'));

    await expect(service.ingest(base)).rejects.toThrow('db down');
  });
});

describe('LogsService.list', () => {
  const seeded = (count: number) =>
    insertLogs(Array.from({ length: count }, (_, i) => makeLog(i + 1)),
    );

  it('asks the repository for limit + 1 rows and passes filters and cursor through', async () => {
    const list = vi.spyOn(logRepo, 'list');
    const filters = { serviceId: 3, search: 'x' };
    const cursor = { timestamp: new Date(0), id: logId(1) };

    await service.list({ filters, limit: 10, cursor });

    expect(list).toHaveBeenCalledWith(filters, { take: 11, cursor });
  });

  it('more rows than limit: slices, hasMore, cursor from the last returned item', async () => {
    await seeded(3);

    const page = await service.list({ filters: {}, limit: 2 });

    expect(page.items.map((l) => l.message)).toEqual(['message 3', 'message 2']);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor ?? '')).toEqual({
      timestamp: page.items[1]?.timestamp,
      id: page.items[1]?.id,
    });
    expect(page.nextCursor).toBe(encodeCursor({ timestamp: makeLog(2).timestamp, id: makeLog(2).id }));
  });

  it.each([2, 1])('%i rows with limit 2: no more pages', async (count) => {
    await seeded(count);

    const page = await service.list({ filters: {}, limit: 2 });

    expect(page.items).toHaveLength(count);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('empty result', async () => {
    expect(await service.list({ filters: {}, limit: 5 })).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('walking pages of 2,2,1 returns everything once, in order', async () => {
    await seeded(5);
    const seen: string[] = [];
    const sizes: number[] = [];
    let raw: string | null = null;
    do {
      const cursor = raw ? (decodeCursor(raw) ?? undefined) : undefined;
      const page = await service.list({ filters: {}, limit: 2, cursor });
      sizes.push(page.items.length);
      seen.push(...page.items.map((l) => l.id));
      raw = page.nextCursor;
    } while (raw);

    expect(sizes).toEqual([2, 2, 1]);
    expect(seen).toEqual([5, 4, 3, 2, 1].map((n) => makeLog(n).id));
  });

  it('propagates repository errors', async () => {
    vi.spyOn(logRepo, 'list').mockRejectedValue(new Error('db down'));

    await expect(service.list({ filters: {}, limit: 1 })).rejects.toThrow('db down');
  });
});

describe('LogsService.stats', () => {
  it('sorts by service id then severity whatever order the repository returns', async () => {
    const levels = ['INFO', 'FATAL', 'DEBUG', 'ERROR', 'WARN', 'INFO'] as const;
    const services = [2, 1, 1, 1, 1, 1];
    await insertLogs(levels.map((level, i) => makeLog(i + 1, { level, serviceId: services[i] ?? 1 })),
    );
    // The order of the repository groups is unspecified; reverse it to prove the service sorts.
    const original = logRepo.countByServiceAndLevel.bind(logRepo);
    vi.spyOn(logRepo, 'countByServiceAndLevel').mockImplementation(async (filters) => (await original(filters)).reverse());

    const stats = await service.stats({});

    expect(stats.groups.map((g) => [g.service.id, g.level])).toEqual([
      [1, 'DEBUG'],
      [1, 'INFO'],
      [1, 'WARN'],
      [1, 'ERROR'],
      [1, 'FATAL'],
      [2, 'INFO'],
    ]);
  });

  it('total is the sum of the counts and names come from the service repository, inactive included', async () => {
    await insertLogs([
      makeLog(1, { serviceId: 1, level: 'ERROR' }),
      makeLog(2, { serviceId: 1, level: 'ERROR' }),
      ...[3, 4, 5, 6, 7].map((n) => makeLog(n, { serviceId: 3, level: 'INFO' })),
    ]);
    const countByServiceAndLevel = vi.spyOn(logRepo, 'countByServiceAndLevel');
    const findNamesByIds = vi.spyOn(serviceRepo, 'findNamesByIds');
    const filters = {};

    const stats = await service.stats(filters);

    expect(stats).toEqual({
      total: 7,
      groups: [
        { service: { id: 1, name: 'svc-1' }, level: 'ERROR', count: 2 },
        { service: { id: 3, name: 'svc-3' }, level: 'INFO', count: 5 },
      ],
    });
    expect(countByServiceAndLevel).toHaveBeenCalledWith(filters);
    // groupBy has no ORDER BY, so the ids can arrive in any order.
    expect(findNamesByIds).toHaveBeenCalledOnce();
    expect(findNamesByIds.mock.calls[0]?.[0].toSorted()).toEqual([1, 3]);
  });

  it('no groups returns an empty result without looking up names', async () => {
    const findNamesByIds = vi.spyOn(serviceRepo, 'findNamesByIds');

    expect(await service.stats({})).toEqual({ total: 0, groups: [] });
    expect(findNamesByIds).not.toHaveBeenCalled();
  });

  it('a group whose service name is missing rejects instead of returning a skewed total', async () => {
    vi.spyOn(logRepo, 'countByServiceAndLevel').mockResolvedValue([{ serviceId: 9, level: 'INFO', count: 1 }]);

    await expect(service.stats({})).rejects.toThrow(/service 9/);
  });
});
