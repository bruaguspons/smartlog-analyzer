import type { PrismaClient } from '@/shared/db/generated/client.js';
import type { LogWhereInput } from '@/shared/db/generated/models/Log.js';
import type { JsonObject, Log, LogFilters, LogPageRequest } from '@/models/log.js';
import type { LogCountGroup, LogRepository } from '@/repositories/log.repository.js';
import { buildLogWhere } from '@/repositories/prisma-log-where.js';

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
    return toLog(row);
  }

  async list(filters: LogFilters, page: LogPageRequest): Promise<Log[]> {
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
    const rows = await this.prisma.log.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: page.take,
    });
    return rows.map(toLog);
  }

  async countByServiceAndLevel(filters: LogFilters): Promise<LogCountGroup[]> {
    const rows = await this.prisma.log.groupBy({
      by: ['serviceId', 'level'],
      where: buildLogWhere(filters),
      _count: { _all: true },
    });
    return rows.map((r) => ({ serviceId: r.serviceId, level: r.level, count: r._count._all }));
  }
}
