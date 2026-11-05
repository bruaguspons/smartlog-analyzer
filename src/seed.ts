import { randomUUIDv7 } from 'node:crypto';
import { runSeed } from '@/seed/run-seed.js';
import { seedLogs } from '@/modules/logs/infrastructure/seed-logs/seed-logs.js';
import { seedServices } from '@/modules/services/infrastructure/seed-services.js';
import { loadConfig } from '@/shared/config/load-config.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';

await runSeed(loadConfig(process.env), {
  createPrisma: createPrismaClient,
  seed: async (prisma) => {
    await seedServices(prisma);
    return seedLogs(prisma, { newId: randomUUIDv7 });
  },
  log: (message) => {
    console.log(message);
  },
});
