import { beforeEach, describe, expect, it } from 'vitest';
import type { Log } from '@/modules/logs/domain/log.types.js';
import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';

const uuid = (n: number) => `0192f1c0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (iso: string) => new Date(iso);
const T = (s: number) => at(`2026-11-03T10:00:${String(s).padStart(2, '0')}.000Z`);

export function makeListLog(n: number, overrides: Partial<Log> = {}): Log {
  return {
    id: uuid(n),
    serviceId: 1,
    level: 'INFO',
    timestamp: T(n),
    message: `message ${n}`,
    traceId: null,
    metadata: null,
    ...overrides,
  };
}

/**
 * Behaviour every `LogRepository.list` implementation must satisfy.
 * `makeRepo` must return an empty repository where services 1 and 2 exist; `seed` persists logs.
 */
export function runLogListContract(
  makeRepo: () => Promise<{ repo: LogRepository; seed: (logs: Log[]) => Promise<void> }>,
): void {
  describe('LogRepository.list contract', () => {
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
}
