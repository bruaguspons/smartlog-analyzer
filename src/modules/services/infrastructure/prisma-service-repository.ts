import type { PrismaClient } from '../../../shared/db/generated/client.js';
import type { Service } from '../domain/service.js';
import type { ServiceRepository } from '../domain/service-repository.js';

export class PrismaServiceRepository implements ServiceRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Inactive services are returned as-is; `authenticate` decides what to do with them. */
  findByApiKey(apiKey: string): Promise<Service | null> {
    return this.prisma.service.findUnique({
      where: { apiKey },
      select: { id: true, name: true, description: true, apiKey: true, isActive: true },
    });
  }

  async findNamesByIds(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.service.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
