import type { PrismaClient } from '../../../shared/db/generated/client.js';
import type { LogWhereInput } from '../../../shared/db/generated/models/Log.js';
import type { LogFilters, LogPageRequest } from '../domain/log-filters.js';
import type { Log, JsonObject } from '../domain/log.js';
import type { LogCountGroup, LogRepository } from '../domain/log-repository.js';

/** Postgres LIKE treats `\\`, `%` and `_` as special; escape them so the search is a literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

type LogRow = Awaited<ReturnType<PrismaClient['log']['create']>>;

function toDomain(row: LogRow): Log {
  return {
    id: row.id,
    serviceId: row.serviceId,
    level: row.level,
    timestamp: row.timestamp,
    message: row.message,
    traceId: row.traceId,
    // Written only by this repository from a validated JSON object, so the narrow cast is safe.
    metadata: row.metadata as JsonObject | null,
  };
}

/** Filter-to-where translation shared by every query so list and stats cannot drift. */
function buildWhere(filters: LogFilters): LogWhereInput {
  const { serviceId, level, from, to, traceId, search } = filters;
  // Keys are added only when defined (exactOptionalPropertyTypes).
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

export class PrismaLogRepository implements LogRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(log: Log): Promise<Log> {
    const row = await this.prisma.log.create({
      data: {
        id: log.id,
        serviceId: log.serviceId,
        level: log.level,
        timestamp: log.timestamp,
        message: log.message,
        traceId: log.traceId,
        // Prisma rejects a raw `null` for a Json column; omitting it stores SQL NULL.
        ...(log.metadata !== null && { metadata: log.metadata }),
      },
    });
    return toDomain(row);
  }

  async list(filters: LogFilters, page: LogPageRequest): Promise<Log[]> {
    const { cursor } = page;
    const where: LogWhereInput = {
      ...buildWhere(filters),
      ...(cursor && {
        // Keyset over (timestamp DESC, id DESC). Kept in its own AND so it never clashes with `timestamp` above.
        AND: [
          {
            OR: [
              { timestamp: { lt: cursor.timestamp } },
              { timestamp: cursor.timestamp, id: { lt: cursor.id } },
            ],
          },
        ],
      }),
    };
    const rows = await this.prisma.log.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
    return rows.map(toDomain);
  }

  async countByServiceAndLevel(filters: LogFilters): Promise<LogCountGroup[]> {
    const rows = await this.prisma.log.groupBy({
      by: ['serviceId', 'level'],
      where: buildWhere(filters),
      _count: { _all: true },
    });
    return rows.map((r) => ({ serviceId: r.serviceId, level: r.level, count: r._count._all }));
  }
}
