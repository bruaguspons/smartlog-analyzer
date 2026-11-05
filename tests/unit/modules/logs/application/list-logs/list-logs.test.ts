import { describe, expect, it, vi } from 'vitest';
import { decodeCursor } from '@/modules/logs/application/cursor/decode-cursor.js';
import { encodeCursor } from '@/modules/logs/application/cursor/encode-cursor.js';
import { listLogs } from '@/modules/logs/application/list-logs/list-logs.js';
import type { Log } from '@/modules/logs/domain/log.types.js';
import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';

async function seeded(count: number) {
  const repo = new InMemoryLogRepository();
  for (let n = 1; n <= count; n++) await repo.create(makeListLog(n));
  return repo;
}

describe('listLogs', () => {
  it('asks the repository for limit + 1 rows and passes filters and cursor through', async () => {
    const list = vi.fn((): Promise<Log[]> => Promise.resolve([]));
    const repo: LogRepository = { create: vi.fn(), list, countByServiceAndLevel: vi.fn() };
    const filters = { serviceId: 3, search: 'x' };
    const cursor = { timestamp: new Date(0), id: makeListLog(1).id };

    await listLogs({ filters, limit: 10, cursor }, { repo });

    expect(list).toHaveBeenCalledWith(filters, { take: 11, cursor });
  });

  it('more rows than limit: slices, hasMore, cursor from the last returned item', async () => {
    const page = await listLogs({ filters: {}, limit: 2 }, { repo: await seeded(3) });

    expect(page.items.map((l) => l.message)).toEqual(['message 3', 'message 2']);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor ?? '')).toEqual({
      timestamp: page.items[1]?.timestamp,
      id: page.items[1]?.id,
    });
    expect(page.nextCursor).toBe(encodeCursor({ timestamp: makeListLog(2).timestamp, id: makeListLog(2).id }));
  });

  it.each([2, 1])('%i rows with limit 2: no more pages', async (count) => {
    const page = await listLogs({ filters: {}, limit: 2 }, { repo: await seeded(count) });

    expect(page.items).toHaveLength(count);
    expect(page).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('empty result', async () => {
    expect(await listLogs({ filters: {}, limit: 5 }, { repo: await seeded(0) })).toEqual({
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
      const page = await listLogs({ filters: {}, limit: 2, cursor }, { repo });
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
    await expect(listLogs({ filters: {}, limit: 1 }, { repo })).rejects.toThrow('db down');
  });
});
