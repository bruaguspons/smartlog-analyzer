import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '@/shared/config/config.js';
import { PrismaClient } from '@/shared/db/generated/client.js';

/** The only Prisma client. The pool is lazy: importing this module does not open a connection. */
export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.databaseUrl }) });
