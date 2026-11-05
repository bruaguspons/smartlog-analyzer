import type { Config } from '@/shared/config/config.types.js';
import type { SeedRunDeps } from './run-seed.types.js';

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
