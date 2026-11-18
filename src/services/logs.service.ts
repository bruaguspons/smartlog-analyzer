import { randomUUIDv7 } from 'node:crypto';
import { LOG_LEVELS, type JsonObject, type Log, type LogCursor, type LogFilters, type LogLevel } from '@/models/log.js';
import { logRepository } from '@/repositories/log.repository.js';
import { serviceRepository } from '@/repositories/service.repository.js';
import { encodeCursor } from '@/shared/cursor.js';

export interface IngestLogCommand {
  /** Resolved from the API key by the caller, never from the request body. */
  serviceId: number;
  level: LogLevel;
  timestamp: Date;
  message: string;
  traceId?: string | undefined;
  metadata?: JsonObject | undefined;
}

export interface ListLogsQuery {
  filters: LogFilters;
  limit: number;
  cursor?: LogCursor | undefined;
}

export interface LogPage {
  items: Log[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface LogStatsGroup {
  service: { id: number; name: string };
  level: LogLevel;
  count: number;
}

export interface LogStats {
  total: number;
  groups: LogStatsGroup[];
}

export const logsService = {
  ingest(cmd: IngestLogCommand): Promise<Log> {
    return logRepository.create({
      id: randomUUIDv7(),
      serviceId: cmd.serviceId,
      level: cmd.level,
      timestamp: cmd.timestamp,
      message: cmd.message,
      traceId: cmd.traceId ?? null,
      metadata: cmd.metadata ?? null,
    });
  },

  async list(query: ListLogsQuery): Promise<LogPage> {
    // One extra row tells whether another page exists without a count query.
    const rows = await logRepository.list(query.filters, { take: query.limit + 1, cursor: query.cursor });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ timestamp: last.timestamp, id: last.id }) : null;
    return { items, nextCursor, hasMore };
  },

  async stats(filters: LogFilters): Promise<LogStats> {
    const counts = await logRepository.countByServiceAndLevel(filters);
    if (counts.length === 0) return { total: 0, groups: [] };

    const names = await serviceRepository.findNamesByIds([...new Set(counts.map((c) => c.serviceId))]);
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
  },
};

export type LogsService = typeof logsService;
