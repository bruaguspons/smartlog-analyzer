import type { Service } from '@/models/service.js';
import { prisma } from '@/shared/db/prisma.js';

export const serviceRepository = {
  /** Inactive services are returned as-is; `requireApiKey` decides what to do with them. */
  findByApiKey(apiKey: string): Promise<Service | null> {
    return prisma.service.findUnique({
      where: { apiKey },
      select: { id: true, name: true, description: true, apiKey: true, isActive: true },
    });
  },

  /** Names of the existing services among `ids` (inactive included); unknown ids are absent. */
  async findNamesByIds(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.service.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  },
};

export type ServiceRepository = typeof serviceRepository;
