import { beforeEach, describe, expect, it } from 'vitest';
import type { LogFilters } from '../../src/modules/logs/domain/log-filters.js';
import type { Log } from '../../src/modules/logs/domain/log.js';
import type { LogCountGroup, LogRepository } from '../../src/modules/logs/domain/log-repository.js';
import { makeListLog } from './log-repository-list-contract.js';

const T = (s: number) => new Date(`2026-11-03T10:00:${String(s).padStart(2, '0')}.000Z`);
const g = (serviceId: number, level: LogCountGroup['level'], count: number): LogCountGroup => ({
  serviceId,
  level,
  count,
});
/** Group order is unspecified by the port: compare sorted. */
const sorted = (groups: LogCountGroup[]) =>
  [...groups].sort((a, b) => a.serviceId - b.serviceId || a.level.localeCompare(b.level));

/**
 * Behaviour every `LogRepository.countByServiceAndLevel` implementation must satisfy.
 * `makeRepo` must return an empty repository where services 1 and 2 exist; `seed` persists logs.
 */
export function runLogStatsContract(
  makeRepo: () => Promise<{ repo: LogRepository; seed: (logs: Log[]) => Promise<void> }>,
): void {
  describe('LogRepository.countByServiceAndLevel contract', () => {
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
}
