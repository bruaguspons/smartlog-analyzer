import { describe, expect, it, vi } from 'vitest';
import type { Log } from '@/models/log.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
import type { LogCountGroup, LogRepository } from '@/repositories/log.repository.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import { LogsService } from '@/services/logs.service.js';
import { decodeCursor, encodeCursor } from '@/shared/cursor.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';

const noServices: ServiceRepository = { findByApiKey: vi.fn(), findNamesByIds: vi.fn() };

function makeService(logRepo: LogRepository, serviceRepo: ServiceRepository = noServices) {
  return new LogsService({ logRepo, serviceRepo, newId: () => 'X' });
}

const base = { serviceId: 7, level: 'INFO', timestamp: new Date('2026-11-03T10:00:00Z'), message: 'hi' } as const;

describe('LogsService.ingest', () => {
  it('takes the id from newId and the serviceId from the command', async () => {
    const repo = new InMemoryLogRepository();

    const log = await makeService(repo).ingest(base);

    expect(log.id).toBe('X');
    expect(log.serviceId).toBe(7);
    expect(repo.logs).toEqual([log]);
  });

  it('normalizes absent optionals to null', async () => {
    const log = await makeService(new InMemoryLogRepository()).ingest(base);

    expect(log.traceId).toBeNull();
    expect(log.metadata).toBeNull();
  });

  it('keeps provided optionals', async () => {
    const log = await makeService(new InMemoryLogRepository()).ingest({ ...base, traceId: 't', metadata: { a: 1 } });

    expect(log).toMatchObject({ traceId: 't', metadata: { a: 1 } });
  });

  it('calls repo.create exactly once', async () => {
    const create = vi.fn((l: Log) => Promise.resolve(l));
    const repo: LogRepository = {
      create,
      list: () => Promise.reject(new Error('not used')),
      countByServiceAndLevel: () => Promise.reject(new Error('not used')),
    };

    await makeService(repo).ingest(base);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propagates repository errors', async () => {
    const repo: LogRepository = {
      create: () => Promise.reject(new Error('db down')),
      list: () => Promise.reject(new Error('not used')),
      countByServiceAndLevel: () => Promise.reject(new Error('not used')),
    };

    await expect(makeService(repo).ingest(base)).rejects.toThrow('db down');
  });
});

async function seeded(count: number) {
  const repo = new InMemoryLogRepository();
  for (let n = 1; n <= count; n++) await repo.create(makeListLog(n));
  return repo;
}

describe('LogsService.list', () => {
  it('asks the repository for limit + 1 rows and passes filters and cursor through', async () => {
    const list = vi.fn((): Promise<Log[]> => Promise.resolve([]));
    const repo: LogRepository = { create: vi.fn(), list, countByServiceAndLevel: vi.fn() };
    const filters = { serviceId: 3, search: 'x' };
    const cursor = { timestamp: new Date(0), id: makeListLog(1).id };

    await makeService(repo).list({ filters, limit: 10, cursor });

    expect(list).toHaveBeenCalledWith(filters, { take: 11, cursor });
  });

  it('more rows than limit: slices, hasMore, cursor from the last returned item', async () => {
    const page = await makeService(await seeded(3)).list({ filters: {}, limit: 2 });

    expect(page.items.map((l) => l.message)).toEqual(['message 3', 'message 2']);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor ?? '')).toEqual({
      timestamp: page.items[1]?.timestamp,
      id: page.items[1]?.id,
    });
    expect(page.nextCursor).toBe(encodeCursor({ timestamp: makeListLog(2).timestamp, id: makeListLog(2).id }));
  });

  it.each([2, 1])('%i rows with limit 2: no more pages', async (count) => {
    const page = await makeService(await seeded(count)).list({ filters: {}, limit: 2 });

    expect(page.items).toHaveLength(count);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('empty result', async () => {
    expect(await makeService(await seeded(0)).list({ filters: {}, limit: 5 })).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
  });

  it('walking pages of 2,2,1 returns everything once, in order', async () => {
    const repo = await seeded(5);
    const seen: string[] = [];
    const sizes: number[] = [];
    let raw: string | null = null;
    do {
      const cursor = raw ? (decodeCursor(raw) ?? undefined) : undefined;
      const page = await makeService(repo).list({ filters: {}, limit: 2, cursor });
      sizes.push(page.items.length);
      seen.push(...page.items.map((l) => l.id));
      raw = page.nextCursor;
    } while (raw);

    expect(sizes).toEqual([2, 2, 1]);
    expect(seen).toEqual([5, 4, 3, 2, 1].map((n) => makeListLog(n).id));
  });

  it('propagates repository errors', async () => {
    const repo: LogRepository = {
      create: vi.fn(),
      list: () => Promise.reject(new Error('db down')),
      countByServiceAndLevel: vi.fn(),
    };
    await expect(makeService(repo).list({ filters: {}, limit: 1 })).rejects.toThrow('db down');
  });
});

function deps(groups: LogCountGroup[], names: [number, string][] = [[1, 'one'], [2, 'two'], [3, 'off']]) {
  const countByServiceAndLevel = vi.fn((): Promise<LogCountGroup[]> => Promise.resolve(groups));
  const findNamesByIds = vi.fn((): Promise<Map<number, string>> => Promise.resolve(new Map(names)));
  const repo: LogRepository = { create: vi.fn(), list: vi.fn(), countByServiceAndLevel };
  const serviceRepo: ServiceRepository = { findByApiKey: vi.fn(), findNamesByIds };
  return { service: makeService(repo, serviceRepo), countByServiceAndLevel, findNamesByIds };
}

describe('LogsService.stats', () => {
  it('sorts by service id then severity whatever order the repository returns', async () => {
    const groups: LogCountGroup[] = [
      { serviceId: 2, level: 'INFO', count: 1 },
      { serviceId: 1, level: 'FATAL', count: 1 },
      { serviceId: 1, level: 'DEBUG', count: 1 },
      { serviceId: 1, level: 'ERROR', count: 1 },
      { serviceId: 1, level: 'WARN', count: 1 },
      { serviceId: 1, level: 'INFO', count: 1 },
    ];

    const stats = await deps(groups).service.stats({});

    expect(stats.groups.map((g) => [g.service.id, g.level])).toEqual([
      [1, 'DEBUG'],
      [1, 'INFO'],
      [1, 'WARN'],
      [1, 'ERROR'],
      [1, 'FATAL'],
      [2, 'INFO'],
    ]);
  });

  it('total is the sum of the counts and names come from the service repository', async () => {
    const d = deps([
      { serviceId: 1, level: 'ERROR', count: 2 },
      { serviceId: 3, level: 'INFO', count: 5 },
    ]);
    const filters = { serviceId: 1, search: 'x' };

    const stats = await d.service.stats(filters);

    expect(stats).toEqual({
      total: 7,
      groups: [
        { service: { id: 1, name: 'one' }, level: 'ERROR', count: 2 },
        { service: { id: 3, name: 'off' }, level: 'INFO', count: 5 },
      ],
    });
    expect(d.countByServiceAndLevel).toHaveBeenCalledWith(filters);
    expect(d.findNamesByIds).toHaveBeenCalledWith([1, 3]);
  });

  it('no groups returns an empty result without looking up names', async () => {
    const d = deps([]);

    expect(await d.service.stats({})).toEqual({ total: 0, groups: [] });
    expect(d.findNamesByIds).not.toHaveBeenCalled();
  });

  it('a group whose service name is missing rejects instead of returning a skewed total', async () => {
    const d = deps([{ serviceId: 9, level: 'INFO', count: 1 }]);

    await expect(d.service.stats({})).rejects.toThrow(/service 9/);
  });
});
