import type { Config } from './shared/config/env.js';
import type { PrismaClient } from './shared/db/generated/client.js';

export interface SeedRunDeps {
  createPrisma: (databaseUrl: string) => PrismaClient;
  /** Seeds services then sample logs; returns how many sample logs were inserted. */
  seed: (prisma: PrismaClient) => Promise<number>;
  log: (message: string) => void;
}

/** `SEED_ON_START=false` skips everything (no connection, no rows); the pool is always released. */
export async function runSeed(config: Pick<Config, 'seedOnStart' | 'databaseUrl'>, deps: SeedRunDeps): Promise<void> {
  if (!config.seedOnStart) {
    deps.log('SEED_ON_START is false, skipping seed');
    return;
  }
  const prisma = deps.createPrisma(config.databaseUrl);
  try {
    const sampleLogs = await deps.seed(prisma);
    deps.log(`Seed completed (${String(sampleLogs)} sample logs)`);
  } finally {
    await prisma.$disconnect();
  }
}
