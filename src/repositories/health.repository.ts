import { prisma } from '@/shared/db/prisma.js';

export const healthRepository = {
  /** Resolves when the database answers a trivial query; rejects otherwise. Callers bound it with a timeout. */
  async ping(): Promise<void> {
    await prisma.$queryRaw`SELECT 1`;
  },
};

export type HealthRepository = typeof healthRepository;
