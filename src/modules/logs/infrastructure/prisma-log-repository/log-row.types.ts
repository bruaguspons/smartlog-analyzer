import type { PrismaClient } from '@/shared/db/generated/client.js';

export type LogRow = Awaited<ReturnType<PrismaClient['log']['create']>>;
