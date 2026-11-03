import type { PrismaClient } from '../../../shared/db/generated/client.js';
import type { Log, JsonObject } from '../domain/log.js';
import type { LogRepository } from '../domain/log-repository.js';

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
}
