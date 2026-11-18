import type { LogWhereInput } from '@/shared/db/generated/models/Log.js';
import type { LogFilters } from '@/models/log.js';

/** Filter-to-where translation shared by every query so list and stats cannot drift. */
export function buildLogWhere(filters: LogFilters): LogWhereInput {
  const { serviceId, level, from, to, traceId, search } = filters;
  // Only filters that are set become conditions; an absent filter adds no key.
  return {
    ...(serviceId !== undefined && { serviceId }),
    ...(level !== undefined && { level: { in: [...level] } }),
    ...((from !== undefined || to !== undefined) && {
      timestamp: { ...(from && { gte: from }), ...(to && { lte: to }) },
    }),
    ...(traceId !== undefined && { traceId }),
    ...(search !== undefined && { message: { contains: escapeLike(search), mode: 'insensitive' } }),
  };
}

/** Postgres LIKE treats `\\`, `%` and `_` as special; escape them so the search is a literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
