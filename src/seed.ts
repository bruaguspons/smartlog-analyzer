import { randomUUIDv7 } from 'node:crypto';
import { runSeed } from './run-seed.js';
import { seedLogs } from './modules/logs/infrastructure/seed-logs.js';
import { seedServices } from './modules/services/infrastructure/seed-services.js';
import { loadConfig } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma-client.js';

await runSeed(loadConfig(process.env), {
  createPrisma: createPrismaClient,
  seed: async (prisma) => {
    await seedServices(prisma);
    return seedLogs(prisma, { newId: randomUUIDv7, now: () => new Date() });
  },
  log: (message) => {
    console.log(message);
  },
});
