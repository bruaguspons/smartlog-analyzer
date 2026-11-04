import type { LogFilters, LogPageRequest } from '../domain/log-filters.js';
import type { Log } from '../domain/log.js';
import type { LogCountGroup, LogRepository } from '../domain/log-repository.js';

function matches(log: Log, f: LogFilters): boolean {
  return (
    (f.serviceId === undefined || log.serviceId === f.serviceId) &&
    (f.level === undefined || f.level.includes(log.level)) &&
    (f.from === undefined || log.timestamp.getTime() >= f.from.getTime()) &&
    (f.to === undefined || log.timestamp.getTime() <= f.to.getTime()) &&
    (f.traceId === undefined || log.traceId === f.traceId) &&
    (f.search === undefined || log.message.toLowerCase().includes(f.search.toLowerCase()))
  );
}

/** `(timestamp DESC, id DESC)`; lowercase hex ids compare like Postgres uuid bytes. */
function newestFirst(a: Log, b: Log): number {
  return b.timestamp.getTime() - a.timestamp.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
}

export class InMemoryLogRepository implements LogRepository {
  readonly logs: Log[] = [];

  create(log: Log): Promise<Log> {
    this.logs.push(log);
    return Promise.resolve(log);
  }

  list(filters: LogFilters, page: LogPageRequest): Promise<Log[]> {
    const { cursor } = page;
    const rows = this.logs
      .filter((log) => matches(log, filters))
      .sort(newestFirst)
      .filter((log) => !cursor || newestFirst(log, { ...log, ...cursor }) > 0);
    return Promise.resolve(rows.slice(0, page.take));
  }

  countByServiceAndLevel(filters: LogFilters): Promise<LogCountGroup[]> {
    const groups = new Map<string, LogCountGroup>();
    for (const { serviceId, level } of this.logs.filter((log) => matches(log, filters))) {
      const key = `${serviceId}|${level}`;
      const group = groups.get(key) ?? { serviceId, level, count: 0 };
      group.count += 1;
      groups.set(key, group);
    }
    return Promise.resolve([...groups.values()]);
  }
}
