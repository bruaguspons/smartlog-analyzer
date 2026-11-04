import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { PrismaServiceRepository } from '../../src/modules/services/infrastructure/prisma-service-repository.js';
import { DEV_SERVICES, seedServices } from '../../src/modules/services/infrastructure/seed-services.js';
import { createPrismaClient } from '../../src/shared/db/prisma-client.js';

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

describe('PrismaServiceRepository', () => {
  it('returns the stored active service', async () => {
    await prisma.service.create({ data: { name: 'svc', apiKey: 'key-1' } });

    expect(await repository.findByApiKey('key-1')).toEqual({
      id: 1,
      name: 'svc',
      description: null,
      apiKey: 'key-1',
      isActive: true,
    });
  });

  it('returns null for an unknown key', async () => {
    expect(await repository.findByApiKey('missing')).toBeNull();
  });

  it('matches the key case-sensitively', async () => {
    await prisma.service.create({ data: { name: 'svc', apiKey: 'Key-1' } });

    expect(await repository.findByApiKey('key-1')).toBeNull();
  });

  it('returns inactive services as inactive', async () => {
    await prisma.service.create({ data: { name: 'svc', apiKey: 'key-1', isActive: false } });

    expect((await repository.findByApiKey('key-1'))?.isActive).toBe(false);
  });

  it('enforces a unique api_key', async () => {
    await prisma.service.create({ data: { name: 'a', apiKey: 'dup' } });

    await expect(prisma.service.create({ data: { name: 'b', apiKey: 'dup' } })).rejects.toThrow();
  });
});

describe('PrismaServiceRepository.findNamesByIds', () => {
  it('returns an empty map for no ids', async () => {
    expect((await repository.findNamesByIds([])).size).toBe(0);
  });

  it('resolves existing ids (inactive included), omits unknown ones and tolerates duplicates', async () => {
    await prisma.service.create({ data: { name: 'a', apiKey: 'k1' } });
    await prisma.service.create({ data: { name: 'b', apiKey: 'k2', isActive: false } });

    expect(await repository.findNamesByIds([1, 2, 2, 99])).toEqual(
      new Map([
        [1, 'a'],
        [2, 'b'],
      ]),
    );
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
