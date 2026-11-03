import { seedServices } from './modules/services/infrastructure/seed-services.js';
import { loadConfig } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma-client.js';

const config = loadConfig(process.env);

if (config.seedOnStart) {
  const prisma = createPrismaClient(config.databaseUrl);
  try {
    await seedServices(prisma);
    console.log('Seed completed');
  } finally {
    await prisma.$disconnect();
  }
} else {
  console.log('SEED_ON_START is false, skipping seed');
}
