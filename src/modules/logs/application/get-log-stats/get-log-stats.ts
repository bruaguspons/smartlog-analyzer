import type { LogFilters } from '@/modules/logs/domain/log-filters.types.js';
import { LOG_LEVELS } from '@/modules/logs/domain/log.const.js';
import type { GetLogStatsDeps, LogStats, LogStatsGroup } from './get-log-stats.types.js';

export async function getLogStats(filters: LogFilters, deps: GetLogStatsDeps): Promise<LogStats> {
  const counts = await deps.repo.countByServiceAndLevel(filters);
  if (counts.length === 0) return { total: 0, groups: [] };

  const names = await deps.serviceRepo.findNamesByIds([...new Set(counts.map((c) => c.serviceId))]);
  const groups = counts.map((c): LogStatsGroup => {
    const name = names.get(c.serviceId);
    // FK logs.service_id and no delete path make this an invariant break: fail loudly (500) rather than skew `total`.
    if (name === undefined) throw new Error(`Log stats: service ${c.serviceId} not found`);
    return { service: { id: c.serviceId, name }, level: c.level, count: c.count };
  });
  groups.sort(
    (a, b) => a.service.id - b.service.id || LOG_LEVELS.indexOf(a.level) - LOG_LEVELS.indexOf(b.level),
  );
  return { total: groups.reduce((sum, g) => sum + g.count, 0), groups };
}
