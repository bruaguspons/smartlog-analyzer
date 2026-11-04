import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { PrismaServiceRepository } from '../../src/modules/services/infrastructure/prisma-service-repository.js';
import { DEV_SERVICES, seedServices } from '../../src/modules/services/infrastructure/seed-services.js';
import { createPrismaClient } from '../../src/shared/db/prisma-client.js';
import { runServiceRepositoryContract } from '../shared/service-repository-contract.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const repository = new PrismaServiceRepository(prisma);

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE services RESTART IDENTITY CASCADE`;
});

runServiceRepositoryContract(async (services) => {
  await prisma.$executeRaw`TRUNCATE services RESTART IDENTITY CASCADE`;
  await prisma.service.createMany({ data: services });
  return repository;
});

describe('PrismaServiceRepository', () => {
  it('enforces a unique api_key', async () => {
    await prisma.service.create({ data: { name: 'a', apiKey: 'dup' } });

    await expect(prisma.service.create({ data: { name: 'b', apiKey: 'dup' } })).rejects.toThrow(/unique constraint/i);
  });
});

describe('seedServices', () => {
  it('is idempotent: two runs leave exactly 3 services (2 active, 1 inactive)', async () => {
    await seedServices(prisma);
    await seedServices(prisma);

    expect(await prisma.service.count()).toBe(DEV_SERVICES.length);
    expect(await prisma.service.count({ where: { isActive: true } })).toBe(2);
    expect(await prisma.service.count({ where: { isActive: false } })).toBe(1);
  });
});
