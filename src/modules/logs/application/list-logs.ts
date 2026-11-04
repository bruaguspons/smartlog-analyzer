import type { LogCursor, LogFilters } from '../domain/log-filters.js';
import type { Log } from '../domain/log.js';
import type { LogRepository } from '../domain/log-repository.js';
import { encodeCursor } from './log-cursor.js';

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

export interface ListLogsDeps {
  repo: LogRepository;
}

export async function listLogs(query: ListLogsQuery, deps: ListLogsDeps): Promise<LogPage> {
  // One extra row tells whether another page exists without a count query.
  const rows = await deps.repo.list(query.filters, { take: query.limit + 1, cursor: query.cursor });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ timestamp: last.timestamp, id: last.id }) : null;
  return { items, nextCursor, hasMore };
}
