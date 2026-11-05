import type { PrismaClient } from '@/shared/db/generated/client.js';

export interface SeedRunDeps {
  createPrisma: (databaseUrl: string) => PrismaClient;
  /** Seeds services then sample logs; returns how many sample logs were inserted. */
  seed: (prisma: PrismaClient) => Promise<number>;
  log: (message: string) => void;
}
