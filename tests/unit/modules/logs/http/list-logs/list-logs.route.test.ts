import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app/build-app.js';
import { createLogsRoutes } from '@/modules/logs/http/create-logs-routes.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '@/modules/services/domain/service.types.js';
import { InMemoryServiceRepository } from '@/modules/services/infrastructure/in-memory-service-repository.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-03T12:00:00.000Z');

describe('GET /api/logs', () => {
  let app: FastifyInstance;
  const A: Service = { id: 1, name: 'a', description: null, apiKey: 'k-a', isActive: true };
  const B: Service = { id: 2, name: 'b', description: null, apiKey: 'k-b', isActive: true };
  const OFF: Service = { id: 3, name: 'off', description: null, apiKey: 'k-off', isActive: false };
  const keyA = { 'x-api-key': 'k-a' };

  interface Page {
    items: { id: string; serviceId: number; level: string }[];
    nextCursor: string | null;
    hasMore: boolean;
    error: { code: string; details?: unknown[] };
  }
  const page = (res: { json: () => unknown }) => res.json() as Page;

  async function build(count = 0, repo = new InMemoryLogRepository()) {
    for (let n = 1; n <= count; n++) {
      await repo.create(
        makeListLog(n, { serviceId: n % 2 ? 1 : 2, level: n % 2 ? 'ERROR' : 'FATAL' }),
      );
    }
    const serviceRepo = new InMemoryServiceRepository([A, B, OFF]);
    app = buildApp({
      serviceRepository: serviceRepo,
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [createLogsRoutes({ repo, serviceRepo, newId: () => ID, now: () => NOW })],
      logLevel: 'silent',
    });
    return repo;
  }
  const get = (url: string, h: Record<string, string> = keyA) => app.inject({ method: 'GET', url, headers: h });

  afterEach(() => app.close());

  it('200 with exactly items/nextCursor/hasMore and the seven camelCase item keys', async () => {
    await build(1);
    const res = await get('/api/logs');
    expect(res.statusCode).toBe(200);
    expect(Object.keys(page(res)).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    expect(Object.keys(page(res).items[0] ?? {}).sort()).toEqual(
      ['id', 'level', 'message', 'metadata', 'serviceId', 'timestamp', 'traceId'],
    );
  });

  it('empty result', async () => {
    await build();
    const res = await get('/api/logs');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('lists every service; serviceId only filters', async () => {
    await build(4);
    expect(page(await get('/api/logs')).items.map((i) => i.serviceId).sort()).toEqual([1, 1, 2, 2]);
    expect(page(await get('/api/logs?serviceId=2')).items.map((i) => i.serviceId)).toEqual([2, 2]);
  });

  it('repeated and single level', async () => {
    await build(4);
    expect(page(await get('/api/logs?level=ERROR')).items).toHaveLength(2);
    expect(page(await get('/api/logs?level=ERROR&level=FATAL')).items).toHaveLength(4);
  });

  it('follows nextCursor until null', async () => {
    await build(5);
    const sizes: number[] = [];
    const seen: string[] = [];
    let url = '/api/logs?limit=2';
    for (;;) {
      const body = page(await get(url));
      sizes.push(body.items.length);
      seen.push(...body.items.map((i) => i.id));
      if (!body.nextCursor) break;
      url = `/api/logs?limit=2&cursor=${body.nextCursor}`;
    }
    expect(sizes).toEqual([2, 2, 1]);
    expect(new Set(seen).size).toBe(5);
  });

  it('without limit the page holds 50 items; exactly 50 rows is the last page, 51 has more', async () => {
    await build(50);
    const exact = page(await get('/api/logs'));
    await app.close();
    await build(51);
    const over = page(await get('/api/logs'));

    expect(exact.items).toHaveLength(50);
    expect(exact.hasMore).toBe(false);
    expect(exact.nextCursor).toBeNull();
    expect(over.items).toHaveLength(50);
    expect(over.hasMore).toBe(true);
    expect(over.nextCursor).not.toBeNull();
  });

  it('limit=200 is the accepted maximum', async () => {
    await build(1);

    expect((await get('/api/logs?limit=200')).statusCode).toBe(200);
  });

  it('missing, unknown and inactive keys give the same 401, before validation', async () => {
    await build();
    const missing = await get('/api/logs?limit=0', {});
    const unknown = await get('/api/logs', { 'x-api-key': 'nope' });
    const inactive = await get('/api/logs', { 'x-api-key': 'k-off' });
    expect(missing.statusCode).toBe(401);
    expect(unknown.json()).toEqual(missing.json());
    expect(inactive.json()).toEqual(missing.json());
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
    'search=',
    'traceId=',
  ])('%s is a 400 VALIDATION_ERROR with a details list', async (query) => {
    await build();
    const res = await get(`/api/logs?${query}`);
    expect(res.statusCode).toBe(400);
    expect(page(res).error.code).toBe('VALIDATION_ERROR');
    expect(page(res).error.details?.length).toBeGreaterThan(0);
  });

  it('500 on repository failure without leaking internals', async () => {
    const repo = new InMemoryLogRepository();
    repo.list = () => Promise.reject(new Error('secret db detail'));
    await build(0, repo);
    const res = await get('/api/logs');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

});
