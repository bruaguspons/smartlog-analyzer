import { describe, expect, it, vi } from 'vitest';
import { getLogStats } from '@/modules/logs/application/get-log-stats/get-log-stats.js';
import type { LogCountGroup, LogRepository } from '@/modules/logs/domain/log-repository.types.js';
import type { ServiceRepository } from '@/modules/services/domain/service-repository.types.js';

function deps(groups: LogCountGroup[], names: [number, string][] = [[1, 'one'], [2, 'two'], [3, 'off']]) {
  const countByServiceAndLevel = vi.fn((): Promise<LogCountGroup[]> => Promise.resolve(groups));
  const findNamesByIds = vi.fn((): Promise<Map<number, string>> => Promise.resolve(new Map(names)));
  const repo: LogRepository = { create: vi.fn(), list: vi.fn(), countByServiceAndLevel };
  const serviceRepo: ServiceRepository = { findByApiKey: vi.fn(), findNamesByIds };
  return { repo, serviceRepo, countByServiceAndLevel, findNamesByIds };
}

describe('getLogStats', () => {
  it('sorts by service id then severity whatever order the repository returns', async () => {
    const groups: LogCountGroup[] = [
      { serviceId: 2, level: 'INFO', count: 1 },
      { serviceId: 1, level: 'FATAL', count: 1 },
      { serviceId: 1, level: 'DEBUG', count: 1 },
      { serviceId: 1, level: 'ERROR', count: 1 },
      { serviceId: 1, level: 'WARN', count: 1 },
      { serviceId: 1, level: 'INFO', count: 1 },
    ];

    const stats = await getLogStats({}, deps(groups));

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

    const stats = await getLogStats(filters, d);

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

    expect(await getLogStats({}, d)).toEqual({ total: 0, groups: [] });
    expect(d.findNamesByIds).not.toHaveBeenCalled();
  });

  it('a group whose service name is missing rejects instead of returning a skewed total', async () => {
    const d = deps([{ serviceId: 9, level: 'INFO', count: 1 }]);

    await expect(getLogStats({}, d)).rejects.toThrow(/service 9/);
  });
});
