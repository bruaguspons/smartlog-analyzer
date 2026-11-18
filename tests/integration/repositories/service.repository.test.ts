import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Service } from '@/models/service.js';
import { PrismaServiceRepository } from '@/repositories/prisma-service.repository.js';
import { DEV_SERVICES, seedServices } from '@/seed/seed-services.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { makeService } from '@tests/support/fixtures.js';

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

/** Makes the repository hold exactly the given services (ids included). */
async function seed(services: Service[]): Promise<void> {
  await prisma.service.createMany({ data: services });
}

describe('ServiceRepository', () => {
  describe('findByApiKey', () => {
    it('returns the stored active service', async () => {
      await seed([makeService(1, { description: 'd' })]);

      expect(await repository.findByApiKey('key-1')).toEqual(makeService(1, { description: 'd' }));
    });

    it('returns null for an unknown key', async () => {
      await seed([makeService(1)]);

      expect(await repository.findByApiKey('missing')).toBeNull();
    });

    it('matches the key case-sensitively', async () => {
      await seed([makeService(1, { apiKey: 'Key-1' })]);

      expect(await repository.findByApiKey('key-1')).toBeNull();
    });

    it('returns inactive services as inactive', async () => {
      await seed([makeService(1, { isActive: false })]);

      expect((await repository.findByApiKey('key-1'))?.isActive).toBe(false);
    });
  });

  describe('findNamesByIds', () => {
    it('returns an empty map for no ids', async () => {
      await seed([makeService(1)]);

      expect((await repository.findNamesByIds([])).size).toBe(0);
    });

    it('resolves existing ids, inactive services included', async () => {
      await seed([makeService(1), makeService(2, { isActive: false })]);

      expect(await repository.findNamesByIds([1, 2])).toEqual(
        new Map([
          [1, 'svc-1'],
          [2, 'svc-2'],
        ]),
      );
    });

    it('omits unknown ids without failing', async () => {
      await seed([makeService(1)]);

      expect(await repository.findNamesByIds([1, 99])).toEqual(new Map([[1, 'svc-1']]));
    });

    it('tolerates duplicated ids', async () => {
      await seed([makeService(1)]);

      expect(await repository.findNamesByIds([1, 1])).toEqual(new Map([[1, 'svc-1']]));
    });
  });
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
