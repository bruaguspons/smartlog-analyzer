import request from 'supertest';
import type { Express } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '@/app.js';
import type { Log } from '@/models/log.js';
import { logRepository as logRepo } from '@/repositories/log.repository.js';
import { prisma } from '@/shared/db/prisma.js';
import { makeLog, makeService } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabase } from '@tests/support/integration/database.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-03T12:00:00.000Z');
// A fixed id and clock make the stored and returned rows reproducible.
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUIDv7: () => '0192f1c0-0000-7000-8000-000000000001',
}));

const keyA = { 'x-api-key': 'k-a' };
const INTERNAL = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };

/** Replaces the stored logs with the given ones and returns the app. */
async function seeded(logs: Log[]): Promise<Express> {
  await prisma.log.deleteMany();
  await insertLogs(logs);
  return app;
}

beforeAll(async () => {
  await prisma.$connect();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
  await prisma.service.createMany({
    data: [
      makeService(1, { name: 'a', apiKey: 'k-a' }),
      makeService(2, { name: 'b', apiKey: 'k-b' }),
      makeService(3, { name: 'off', apiKey: 'k-off', isActive: false }),
    ],
  });
});

describe('POST /api/logs against Postgres', () => {
  const valid = { level: 'ERROR', timestamp: '2026-11-03T10:00:00.123Z', message: 'boom' };
  const post = (app: Express, payload: object, h: Record<string, string> = keyA) => request(app).post('/api/logs').set(h).send(payload);

  it('201 with exactly the seven camelCase keys and the generated id', async () => {
    const body = { ...valid, traceId: 't-1', metadata: { a: 1 } };

    const res = await post(app, body);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: ID, serviceId: 1, ...body });
    expect(Object.keys(res.body as object).sort()).toEqual(['id', 'level', 'message', 'metadata', 'serviceId', 'timestamp', 'traceId']);
  });

  it('takes the service from the key', async () => {
    const res = await post(app, valid, { 'x-api-key': 'k-b' });
    expect((res.body as { serviceId: number }).serviceId).toBe(2);
  });

  it('absent optionals are null', async () => {
    const res = await post(app, valid);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ traceId: null, metadata: null });
  });

  it('normalizes an offset timestamp to UTC', async () => {
    const res = await post(app, { ...valid, timestamp: '2026-11-03T08:00:00-03:00' });
    expect((res.body as { timestamp: string }).timestamp).toBe('2026-11-03T11:00:00.000Z');
  });

  it('a body serviceId is rejected and nothing is persisted', async () => {
    const res = await post(app, { ...valid, serviceId: 9 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(await prisma.log.count()).toBe(0);
  });

  it('a missing key with an invalid body is 401, not 400', async () => {
    const res = await post(app, { nope: true }, {});
    expect(res.status).toBe(401);
    expect(await prisma.log.count()).toBe(0);
  });

  it('inactive and unknown keys give an identical 401', async () => {
    const inactive = await post(app, valid, { 'x-api-key': 'k-off' });
    const unknown = await post(app, valid, { 'x-api-key': 'nope' });
    expect(inactive.status).toBe(401);
    expect(inactive.body).toEqual(unknown.body);
  });

  it('future skew gives 400 with /timestamp in details', async () => {
    const res = await post(app, { ...valid, timestamp: new Date(NOW.getTime() + 300_001).toISOString() });
    expect(res.status).toBe(400);
    expect((res.body as { error: { details: unknown[] } }).error.details).toEqual([expect.objectContaining({ instancePath: '/timestamp' })]);
  });

  it('two invalid fields give two details and persist nothing', async () => {
    const res = await post(app, { ...valid, level: 'x', message: '' });
    expect(res.status).toBe(400);
    expect((res.body as { error: { details: unknown[] } }).error.details).toHaveLength(2);
    expect(await prisma.log.count()).toBe(0);
  });

  it('malformed JSON is a 400 VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/logs').set(keyA).set('Content-Type', 'application/json').send('{"level":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('a body over 1 MiB is a 413 PAYLOAD_TOO_LARGE', async () => {
    const res = await post(app, { ...valid, message: 'a'.repeat(1_048_577) });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
  });

  it('500 on repository failure without leaking internals', async () => {
    vi.spyOn(logRepo, 'create').mockRejectedValue(new Error('secret db detail'));

    const res = await post(app, valid);

    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL);
    expect(res.text).not.toContain('secret');
  });
});

describe('GET /api/logs against Postgres', () => {
  interface Page {
    items: { id: string; serviceId: number; level: string }[];
    nextCursor: string | null;
    hasMore: boolean;
  }
  const get = (app: Express, url: string, h: Record<string, string> = keyA) => request(app).get(url).set(h);
  const page = (res: { body: unknown }) => res.body as Page;
  const logsFor = (count: number) =>
    Array.from({ length: count }, (_, i) => makeLog(i + 1, { serviceId: (i + 1) % 2 ? 1 : 2, level: (i + 1) % 2 ? 'ERROR' : 'FATAL' }));

  it('200 with exactly items/nextCursor/hasMore and the seven camelCase item keys', async () => {
    const res = await get(await seeded(logsFor(1)), '/api/logs');
    expect(res.status).toBe(200);
    expect(Object.keys(page(res)).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    expect(Object.keys(page(res).items[0] ?? {}).sort()).toEqual(['id', 'level', 'message', 'metadata', 'serviceId', 'timestamp', 'traceId']);
  });

  it('empty result', async () => {
    const res = await get(app, '/api/logs');
    expect(res.body).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('lists every service; serviceId only filters', async () => {
    const app = await seeded(logsFor(4));
    expect(page(await get(app, '/api/logs')).items.map((i) => i.serviceId).sort()).toEqual([1, 1, 2, 2]);
    expect(page(await get(app, '/api/logs?serviceId=2')).items.map((i) => i.serviceId)).toEqual([2, 2]);
  });

  it('repeated and single level', async () => {
    const app = await seeded(logsFor(4));
    expect(page(await get(app, '/api/logs?level=ERROR')).items).toHaveLength(2);
    expect(page(await get(app, '/api/logs?level=ERROR&level=FATAL')).items).toHaveLength(4);
  });

  it('follows nextCursor until null', async () => {
    const app = await seeded(logsFor(5));
    const sizes: number[] = [];
    const seen: string[] = [];
    let url = '/api/logs?limit=2';
    for (;;) {
      const body = page(await get(app, url));
      sizes.push(body.items.length);
      seen.push(...body.items.map((i) => i.id));
      if (!body.nextCursor) break;
      url = `/api/logs?limit=2&cursor=${body.nextCursor}`;
    }
    expect(sizes).toEqual([2, 2, 1]);
    expect(new Set(seen).size).toBe(5);
  });

  it('without limit the page holds 50 items; exactly 50 rows is the last page, 51 has more', async () => {
    const exact = page(await get(await seeded(logsFor(50)), '/api/logs'));
    const over = page(await get(await seeded(logsFor(51)), '/api/logs'));

    expect(exact.items).toHaveLength(50);
    expect(exact.hasMore).toBe(false);
    expect(exact.nextCursor).toBeNull();
    expect(over.items).toHaveLength(50);
    expect(over.hasMore).toBe(true);
    expect(over.nextCursor).not.toBeNull();
  });

  it('limit=200 is the accepted maximum', async () => {
    expect((await get(await seeded(logsFor(1)), '/api/logs?limit=200')).status).toBe(200);
  });

  it('missing, unknown and inactive keys give the same 401, before validation', async () => {
    const missing = await get(app, '/api/logs?limit=0', {});
    const unknown = await get(app, '/api/logs', { 'x-api-key': 'nope' });
    const inactive = await get(app, '/api/logs', { 'x-api-key': 'k-off' });
    expect(missing.status).toBe(401);
    expect(unknown.body).toEqual(missing.body);
    expect(inactive.body).toEqual(missing.body);
  });

  it.each([
    'limit=0',
    'limit=201',
    'limit=abc',
    'cursor=!!!',
    'cursor=',
    'level=TRACE',
    'from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z',
    'foo=1',
    'level[]=ERROR',
    'search=',
    'traceId=',
  ])('%s is a 400 VALIDATION_ERROR with a details list', async (query) => {
    const res = await get(app, `/api/logs?${query}`);
    expect(res.status).toBe(400);
    const { error } = res.body as { error: { code: string; details: unknown[] } };
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.length).toBeGreaterThan(0);
  });

  it('500 on repository failure without leaking internals', async () => {
    vi.spyOn(logRepo, 'list').mockRejectedValue(new Error('secret db detail'));

    const res = await get(app, '/api/logs');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL);
  });
});

describe('GET /api/logs/stats against Postgres', () => {
  interface Stats {
    total: number;
    groups: { service: { id: number; name: string }; level: string; count: number }[];
  }
  const get = (app: Express, url: string, h: Record<string, string> = keyA) => request(app).get(url).set(h);
  const mixed = () => [
    makeLog(1, { serviceId: 1, level: 'ERROR' }),
    makeLog(2, { serviceId: 1, level: 'ERROR' }),
    makeLog(3, { serviceId: 1, level: 'INFO' }),
    makeLog(4, { serviceId: 2, level: 'ERROR', traceId: 't' }),
    makeLog(5, { serviceId: 3, level: 'FATAL' }),
  ];

  it('200 with exactly total/groups over every service, inactive included, in order', async () => {
    const res = await get(await seeded(mixed()), '/api/logs/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      total: 5,
      groups: [
        { service: { id: 1, name: 'a' }, level: 'INFO', count: 1 },
        { service: { id: 1, name: 'a' }, level: 'ERROR', count: 2 },
        { service: { id: 2, name: 'b' }, level: 'ERROR', count: 1 },
        { service: { id: 3, name: 'off' }, level: 'FATAL', count: 1 },
      ],
    });
  });

  it('empty result is 200 { total: 0, groups: [] }', async () => {
    expect((await get(app, '/api/logs/stats')).body).toEqual({ total: 0, groups: [] });
  });

  it.each([
    ['missing', {}],
    ['unknown', { 'x-api-key': 'nope' }],
    ['inactive', { 'x-api-key': 'k-off' }],
  ])('%s key is the same 401', async (_label, h) => {
    const res = await get(await seeded(mixed()), '/api/logs/stats', h);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('filters are forwarded and narrow the counts', async () => {
    const app = await seeded(mixed());
    const only = async (query: string) => (await get(app, `/api/logs/stats?${query}`).then((r) => r.body as Stats)).total;
    expect(await only('serviceId=2')).toBe(1);
    expect(await only('level=ERROR&level=FATAL')).toBe(4);
    expect(await only('traceId=t')).toBe(1);
    expect(await only('from=2026-11-03T10:00:03.000Z&to=2026-11-03T10:00:04.000Z')).toBe(2);
    expect(await only('serviceId=1&level=ERROR&search=message')).toBe(2);
  });

  it.each([
    'limit=10',
    'cursor=abc',
    'foo=1',
    'levels=ERROR',
    'level=TRACE',
    'level=error',
    'serviceId=0',
    'from=2026-01-02T00:00:00Z&to=2026-01-01T00:00:00Z',
  ])('%s is a 400 VALIDATION_ERROR with a details list', async (query) => {
    const res = await get(app, `/api/logs/stats?${query}`);
    expect(res.status).toBe(400);
    const { error } = res.body as { error: { code: string; details: unknown[] } };
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details.length).toBeGreaterThan(0);
  });

  it('from equal to to is accepted', async () => {
    const res = await get(app, '/api/logs/stats?from=2026-01-01T00:00:00Z&to=2026-01-01T00:00:00Z');
    expect(res.status).toBe(200);
  });

  it('500 on repository failure without leaking internals', async () => {
    vi.spyOn(logRepo, 'countByServiceAndLevel').mockRejectedValue(new Error('secret db detail'));

    const res = await get(app, '/api/logs/stats');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL);
  });

  it('500 without leaking internals when a group references a service missing from the service repository', async () => {
    vi.spyOn(logRepo, 'countByServiceAndLevel').mockResolvedValue([{ serviceId: 99, level: 'ERROR', count: 1 }]);

    const res = await get(app, '/api/logs/stats');
    expect(res.status).toBe(500);
    expect(res.body).toEqual(INTERNAL);
    expect(res.text).not.toContain('service 99');
  });
});
