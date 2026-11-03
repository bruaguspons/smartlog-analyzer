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
}
