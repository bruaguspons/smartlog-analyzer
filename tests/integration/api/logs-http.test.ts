import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { logId } from '@tests/support/contracts/analysis-repository-contract.js';
import { ScriptedLlmClient, okJson } from '@tests/support/fakes/scripted-llm-client.js';
import { authHeaders, buildIntegrationRuntime, resetDatabase } from '@tests/support/integration/integration-app.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BASE = Date.parse('2026-11-04T09:00:00.000Z');

interface Item {
  id: string;
  serviceId: number;
  level: string;
  timestamp: string;
}
interface Page {
  items: Item[];
  nextCursor: string | null;
  hasMore: boolean;
}
interface Stats {
  total: number;
  groups: { service: { id: number; name: string }; level: string; count: number }[];
}
interface ErrorBody {
  error: { code: string };
}

let app: FastifyInstance;

const get = (url: string, headers: Record<string, string> = authHeaders) =>
  app.inject({ method: 'GET', url, headers });
const getPage = async (url: string) => {
  const res = await get(url);
  expect(res.statusCode).toBe(200);
  return res.json<Page>();
};

/** Inserts `count` logs for service 1 with sequential ids; `stamp(n)` gives the timestamp offset in seconds. */
async function seedLogs(count: number, stamp: (n: number) => number = (n) => n): Promise<void> {
  await prisma.log.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      id: logId(i + 1),
      serviceId: 1,
      level: 'INFO' as const,
      timestamp: new Date(BASE + stamp(i + 1) * 1000),
      message: `log ${String(i + 1)}`,
    })),
  });
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
  ({ app } = buildIntegrationRuntime({ prisma, llm: new ScriptedLlmClient(okJson({ summary: 's', findings: [] })) }));
});

afterEach(async () => {
  await app.close();
});

describe('POST /api/logs against Postgres', () => {
  const valid = { level: 'ERROR', timestamp: '2026-11-04T08:00:00.000Z', message: 'boom' };
  const post = (payload: object, headers: Record<string, string> = authHeaders) =>
    app.inject({ method: 'POST', url: '/api/logs', headers, payload });

  it('201 returns the stored log, with a UUIDv7 id and the service taken from the key', async () => {
    await prisma.service.create({ data: { name: 'other', apiKey: 'key-2' } });

    const res = await post({ ...valid, traceId: 't-1', metadata: { a: 1 } }, { 'x-api-key': 'key-2' });

    expect(res.statusCode).toBe(201);
    const created = res.json<Item & { traceId: string; metadata: object; message: string }>();
    expect(created.id).toMatch(UUID_V7);
    expect(created).toMatchObject({ serviceId: 2, level: 'ERROR', message: 'boom', traceId: 't-1', metadata: { a: 1 } });
    expect(await prisma.log.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
      serviceId: 2,
      message: 'boom',
      timestamp: new Date('2026-11-04T08:00:00.000Z'),
    });
  });

  it('a serviceId in the body is a 400 and nothing is stored', async () => {
    const res = await post({ ...valid, serviceId: 1 });

    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.log.count()).toBe(0);
  });

  it('an unknown key and a missing key give the same 401 body', async () => {
    const missing = await post(valid, {});
    const unknown = await post(valid, { 'x-api-key': 'nope' });

    expect(missing.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toEqual(missing.json());
    expect(await prisma.log.count()).toBe(0);
  });

  it('an inactive service key gets the same 401 body', async () => {
    await prisma.service.create({ data: { name: 'off', apiKey: 'key-off', isActive: false } });

    const inactive = await post(valid, { 'x-api-key': 'key-off' });
    const missing = await post(valid, {});

    expect(inactive.statusCode).toBe(401);
    expect(inactive.json()).toEqual(missing.json());
  });
});

describe('GET /api/logs against Postgres', () => {
  it('exactly 50 rows is one page without more', async () => {
    await seedLogs(50);

    const page = await getPage('/api/logs');

    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('51 rows give 50 items and a cursor whose page has the last row', async () => {
    await seedLogs(51);

    const first = await getPage('/api/logs');
    expect(first.items).toHaveLength(50);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await getPage(`/api/logs?cursor=${first.nextCursor ?? ''}`);
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect(second.items[0]?.id).toBe(logId(1));
  });

  it('limit 200 is accepted; 201 and 0 are a 400 envelope', async () => {
    await seedLogs(1);

    expect((await get('/api/logs?limit=200')).statusCode).toBe(200);
    for (const limit of ['201', '0']) {
      const res = await get(`/api/logs?limit=${limit}`);
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('paginating with limit=7 yields every id once in (timestamp DESC, id DESC) order, equal timestamps included', async () => {
    // 20 rows in 4 groups of 5 sharing a timestamp, so the id tie-break decides inside each group.
    await seedLogs(20, (n) => Math.ceil(n / 5));
    const expected = (await prisma.log.findMany())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || (a.id < b.id ? 1 : -1))
      .map((row) => row.id);

    const seen: string[] = [];
    let url = '/api/logs?limit=7';
    for (;;) {
      const page = await getPage(url);
      seen.push(...page.items.map((item) => item.id));
      if (!page.nextCursor) break;
      url = `/api/logs?limit=7&cursor=${page.nextCursor}`;
    }

    expect(seen).toEqual(expected);
    expect(new Set(seen).size).toBe(20);
  });
});

describe('GET /api/logs/stats against Postgres', () => {
  beforeEach(async () => {
    await prisma.service.create({ data: { name: 'other', apiKey: 'key-2' } });
    const row = (n: number, serviceId: number, level: 'ERROR' | 'INFO', offsetSeconds: number) => ({
      id: logId(n),
      serviceId,
      level,
      timestamp: new Date(BASE + offsetSeconds * 1000),
      message: `log ${String(n)}`,
    });
    await prisma.log.createMany({
      data: [row(1, 1, 'ERROR', 0), row(2, 1, 'ERROR', 10), row(3, 1, 'INFO', 20), row(4, 2, 'ERROR', 30)],
    });
  });

  const stats = async (query = '') => {
    const res = await get(`/api/logs/stats${query}`);
    expect(res.statusCode).toBe(200);
    return res.json<Stats>();
  };
  const summary = (body: Stats) =>
    body.groups
      .map((g) => `${g.service.name}:${g.level}=${String(g.count)}`)
      .sort();

  it('without filters counts every service and level with names resolved', async () => {
    const body = await stats();

    expect(body.total).toBe(4);
    expect(summary(body)).toEqual(['other:ERROR=1', 'svc:ERROR=2', 'svc:INFO=1']);
  });

  it('level and from/to narrow the counts', async () => {
    expect(summary(await stats('?level=ERROR'))).toEqual(['other:ERROR=1', 'svc:ERROR=2']);

    const from = new Date(BASE + 5_000).toISOString();
    const to = new Date(BASE + 25_000).toISOString();
    const windowed = await stats(`?from=${from}&to=${to}`);

    expect(windowed.total).toBe(2);
    expect(summary(windowed)).toEqual(['svc:ERROR=1', 'svc:INFO=1']);
  });

  it('serviceId filters to one service', async () => {
    expect(summary(await stats('?serviceId=2'))).toEqual(['other:ERROR=1']);
  });

  it('a repeated serviceId is rejected (the filter is single-valued), never double counted', async () => {
    const res = await get('/api/logs/stats?serviceId=1&serviceId=1');

    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('limit and cursor are rejected because stats is not paginated', async () => {
    for (const query of ['?limit=10', '?cursor=abc']) {
      const res = await get(`/api/logs/stats${query}`);
      expect(res.statusCode).toBe(400);
      expect(res.json<ErrorBody>().error.code).toBe('VALIDATION_ERROR');
    }
  });
});
