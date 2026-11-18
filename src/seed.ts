import { randomUUIDv7 } from 'node:crypto';
import { runSeed } from '@/seed/run-seed.js';
import { seedLogs } from '@/seed/seed-logs.js';
import { seedServices } from '@/seed/seed-services.js';
import { config } from '@/shared/config/config.js';
import { prisma } from '@/shared/db/prisma.js';

await runSeed(config, {
  createPrisma: () => prisma,
  seed: async (client) => {
    await seedServices(client);
    return seedLogs(client, { newId: randomUUIDv7 });
  },
  log: (message) => {
    console.log(message);
  },
});
