import type { PrismaClient } from '../../../shared/db/generated/client.js';

/** Fixed development keys, documented in the README. Never use them outside local dev. */
export const DEV_SERVICES = [
  { name: 'payments-api', description: 'Dev service (active)', apiKey: 'dev-key-payments-0001', isActive: true },
  { name: 'orders-api', description: 'Dev service (active)', apiKey: 'dev-key-orders-0002', isActive: true },
  { name: 'legacy-batch', description: 'Dev service (inactive)', apiKey: 'dev-key-legacy-0003', isActive: false },
] as const;

/** Idempotent: creates missing services by api_key and never overwrites existing rows. */
export async function seedServices(prisma: PrismaClient): Promise<void> {
  for (const service of DEV_SERVICES) {
    await prisma.service.upsert({ where: { apiKey: service.apiKey }, create: service, update: {} });
  }
}
