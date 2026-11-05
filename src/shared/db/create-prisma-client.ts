import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/shared/db/generated/client.js';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
