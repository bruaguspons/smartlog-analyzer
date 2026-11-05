import type { PrismaClient } from '@/shared/db/generated/client.js';

import { DEV_SERVICES } from './dev-services.const.js';

/** Idempotent: creates missing services by api_key and never overwrites existing rows. */
export async function seedServices(prisma: PrismaClient): Promise<void> {
  for (const service of DEV_SERVICES) {
    await prisma.service.upsert({ where: { apiKey: service.apiKey }, create: service, update: {} });
  }
}
