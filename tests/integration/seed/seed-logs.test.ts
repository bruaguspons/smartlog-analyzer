import { randomUUIDv7 } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { app } from '@/app.js';
import { SAMPLE_LOG_COUNT } from '@/seed/sample-logs.const.js';
import { seedLogs } from '@/seed/seed-logs.js';
import { DEV_SERVICES, seedServices } from '@/seed/seed-services.js';
import { prisma } from '@/shared/db/prisma.js';

const deps = { newId: randomUUIDv7 };
interface Page {
  items: { serviceId: number }[];
}
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE services RESTART IDENTITY CASCADE`;
  await seedServices(prisma);
});

describe('seedLogs', () => {
  it('inserts the sample logs into an empty table with UUIDv7 ids', async () => {
    expect(await prisma.service.count()).toBe(3);
    expect(await seedLogs(prisma, deps)).toBe(SAMPLE_LOG_COUNT);

    const rows = await prisma.log.findMany();
    expect(rows).toHaveLength(SAMPLE_LOG_COUNT);
    for (const row of rows) expect(row.id).toMatch(UUID_V7);
    expect(rows.some((row) => row.level === 'ERROR')).toBe(true);
  });

  it('is idempotent: a second run inserts nothing and leaves the rows unchanged', async () => {
    await seedLogs(prisma, deps);
    const before = await prisma.log.findMany({ orderBy: { id: 'asc' } });

    expect(await seedLogs(prisma, deps)).toBe(0);

    expect(await prisma.log.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  });

  it('inserts nothing when the table already holds a foreign log', async () => {
    const service = await prisma.service.findFirstOrThrow();
    await prisma.log.create({
      data: {
        id: randomUUIDv7(),
        serviceId: service.id,
        level: 'INFO',
        timestamp: new Date(),
        message: 'real log',
      },
    });

    expect(await seedLogs(prisma, deps)).toBe(0);

    expect(await prisma.log.count()).toBe(1);
  });

  it('the seeded logs are served by GET /api/logs with a seeded key, and serviceId narrows them to one service', async () => {
    await seedLogs(prisma, deps);
    const headers = { 'x-api-key': DEV_SERVICES[0].apiKey };
    const all = (await request(app).get('/api/logs?limit=200').set(headers)).body as Page;
    const payments = await prisma.service.findUniqueOrThrow({ where: { apiKey: DEV_SERVICES[0].apiKey } });
    const own = (await request(app).get(`/api/logs?limit=200&serviceId=${String(payments.id)}`).set(headers)).body as Page;

    expect(all.items).toHaveLength(SAMPLE_LOG_COUNT);
    expect(new Set(all.items.map((i) => i.serviceId)).size).toBeGreaterThan(1);
    expect(own.items.length).toBeGreaterThan(0);
    expect(own.items.length).toBeLessThan(SAMPLE_LOG_COUNT);
    expect(own.items.every((i) => i.serviceId === payments.id)).toBe(true);
  });
});
