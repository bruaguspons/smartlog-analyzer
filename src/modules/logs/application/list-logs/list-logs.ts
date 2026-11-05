import { encodeCursor } from '@/modules/logs/application/cursor/encode-cursor.js';
import type { ListLogsDeps, ListLogsQuery, LogPage } from './list-logs.types.js';

export async function listLogs(query: ListLogsQuery, deps: ListLogsDeps): Promise<LogPage> {
  // One extra row tells whether another page exists without a count query.
  const rows = await deps.repo.list(query.filters, { take: query.limit + 1, cursor: query.cursor });
  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;
  const last = items.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ timestamp: last.timestamp, id: last.id }) : null;
  return { items, nextCursor, hasMore };
}
