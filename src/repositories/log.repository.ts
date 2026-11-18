import type { JsonObject, Log, LogFilters, LogLevel, LogPageRequest } from '@/models/log.js';
import { buildLogWhere } from '@/repositories/prisma-log-where.js';
import { prisma } from '@/shared/db/prisma.js';
import type { PrismaClient } from '@/shared/db/generated/client.js';
import type { LogWhereInput } from '@/shared/db/generated/models/Log.js';

/** Raw count of logs for one (service, level) pair; names are resolved by the caller. */
export interface LogCountGroup {
  serviceId: number;
  level: LogLevel;
  count: number;
}

type LogRow = Awaited<ReturnType<PrismaClient['log']['create']>>;

function toLog(row: LogRow): Log {
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

// Methods never use `this`, so callers (and tests) can spy on them through the object.
export const logRepository = {
  async create(log: Log): Promise<Log> {
    const row = await prisma.log.create({
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
    return toLog(row);
  },

  /**
   * At most `page.take` logs matching every filter, ordered `(timestamp DESC, id DESC)`,
   * strictly after `page.cursor` when given.
   */
  async list(filters: LogFilters, page: LogPageRequest): Promise<Log[]> {
    // Build the filter and cursor condition
    const { cursor } = page;
    const where: LogWhereInput = {
      ...buildLogWhere(filters),
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
    // Query the page
    const rows = await prisma.log.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
    return rows.map(toLog);
  },

  /** One group per (service, level) with at least one log matching every filter; order unspecified. */
  async countByServiceAndLevel(filters: LogFilters): Promise<LogCountGroup[]> {
    const rows = await prisma.log.groupBy({
      by: ['serviceId', 'level'],
      where: buildLogWhere(filters),
      _count: { _all: true },
    });
    return rows.map((r) => ({ serviceId: r.serviceId, level: r.level, count: r._count._all }));
  },
};

export type LogRepository = typeof logRepository;
