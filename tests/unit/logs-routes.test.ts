import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { LogRepository } from '../../src/modules/logs/domain/log-repository.js';
import { createLogsRoutes } from '../../src/modules/logs/http/logs-routes.js';
import { InMemoryLogRepository } from '../../src/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '../../src/modules/services/domain/service.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';
import { makeListLog } from '../shared/log-repository-list-contract.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-03T12:00:00.000Z');
const active: Service = { id: 7, name: 'svc', description: null, apiKey: 'k-active', isActive: true };
const off: Service = { id: 8, name: 'off', description: null, apiKey: 'k-off', isActive: false };
interface Body {
  id: string;
  timestamp: string;
  error: { code: string; details?: unknown[] };
}
const json = (res: { json: () => unknown }) => res.json() as Body;
const headers = { 'x-api-key': 'k-active' };
const valid = { level: 'ERROR', timestamp: '2026-11-03T10:00:00.123Z', message: 'boom' };

describe('POST /api/logs', () => {
  let app: FastifyInstance;

  function build(repo: LogRepository = new InMemoryLogRepository(), newId: () => string = () => ID) {
    const serviceRepo = new InMemoryServiceRepository([active, off]);
    app = buildApp({
      serviceRepository: serviceRepo,
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [createLogsRoutes({ repo, serviceRepo, newId, now: () => NOW })],
      logLevel: 'silent',
    });
    return app;
  }

  afterEach(() => app.close());

  const post = (payload: unknown, h: Record<string, string> = headers) =>
    app.inject({ method: 'POST', url: '/api/logs', headers: h, payload: payload as object });

  it('201 with exactly the seven camelCase keys and the generated id', async () => {
    build(undefined, () => ID);
    const body = { ...valid, traceId: 't-1', metadata: { a: 1 } };

    const res = await post(body);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: ID, serviceId: 7, ...body });
    expect(Object.keys(json(res)).sort()).toEqual(
      ['id', 'level', 'message', 'metadata', 'serviceId', 'timestamp', 'traceId'],
    );
  });

  it('absent optionals are null', async () => {
    build();
    const res = await post(valid);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ traceId: null, metadata: null });
  });

  it('normalizes an offset timestamp to UTC', async () => {
    build();
    const res = await post({ ...valid, timestamp: '2026-11-03T08:00:00-03:00' });
    expect(res.statusCode).toBe(201);
    expect(json(res).timestamp).toBe('2026-11-03T11:00:00.000Z');
  });

  it('body serviceId is rejected and nothing is persisted', async () => {
    const repo = new InMemoryLogRepository();
    build(repo);
    const res = await post({ ...valid, serviceId: 9 });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('VALIDATION_ERROR');
    expect(repo.logs).toHaveLength(0);
  });

  it('missing key with an invalid body is 401, not 400', async () => {
    const repo = new InMemoryLogRepository();
    build(repo);
    const res = await post({ nope: true }, {});
    expect(res.statusCode).toBe(401);
    expect(repo.logs).toHaveLength(0);
  });

  it('inactive and unknown keys give an identical 401', async () => {
    build();
    const a = await post(valid, { 'x-api-key': 'k-off' });
    const b = await post(valid, { 'x-api-key': 'nope' });
    expect(a.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it('future skew gives 400 with /timestamp in details', async () => {
    build();
    const res = await post({ ...valid, timestamp: new Date(NOW.getTime() + 300_001).toISOString() });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.details).toEqual([expect.objectContaining({ instancePath: '/timestamp' })]);
  });

  it('two invalid fields give two details and persist nothing', async () => {
    const repo = new InMemoryLogRepository();
    build(repo);
    const res = await post({ ...valid, level: 'x', message: '' });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.details).toHaveLength(2);
    expect(repo.logs).toHaveLength(0);
  });

  it('malformed JSON is a 400 VALIDATION_ERROR', async () => {
    build();
    const res = await app.inject({
      method: 'POST',
      url: '/api/logs',
      headers: { ...headers, 'content-type': 'application/json' },
      payload: '{"level":',
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('VALIDATION_ERROR');
  });

  it('a body over 1 MiB is a 413 PAYLOAD_TOO_LARGE', async () => {
    build();
    const res = await post({ ...valid, message: 'a'.repeat(1_048_577) });
    expect(res.statusCode).toBe(413);
    expect(json(res).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('500 on repository failure without leaking internals', async () => {
    build({
      create: () => Promise.reject(new Error('secret db detail')),
      list: () => Promise.reject(new Error('not used')),
      countByServiceAndLevel: () => Promise.reject(new Error('not used')),
    });
    const res = await post(valid);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(res.body).not.toContain('secret');
  });

});

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

describe('GET /api/logs/stats', () => {
  let app: FastifyInstance;
  const A: Service = { id: 1, name: 'a', description: null, apiKey: 'k-a', isActive: true };
  const B: Service = { id: 2, name: 'b', description: null, apiKey: 'k-b', isActive: true };
  const OFF: Service = { id: 3, name: 'off', description: null, apiKey: 'k-off', isActive: false };
  const keyA = { 'x-api-key': 'k-a' };

  interface Stats {
    total: number;
    groups: { service: { id: number; name: string }; level: string; count: number }[];
    error: { code: string; details?: unknown[] };
  }
  const stats = (res: { json: () => unknown }) => res.json() as Stats;

  async function build(logs: ReturnType<typeof makeListLog>[] = [], repo = new InMemoryLogRepository()) {
    for (const log of logs) await repo.create(log);
    const serviceRepo = new InMemoryServiceRepository([A, B, OFF]);
    app = buildApp({
      serviceRepository: serviceRepo,
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [createLogsRoutes({ repo, serviceRepo, newId: () => ID, now: () => NOW })],
      logLevel: 'silent',
    });
  }
  const get = (url: string, h: Record<string, string> = keyA) => app.inject({ method: 'GET', url, headers: h });
  const mixed = () => [
    makeListLog(1, { serviceId: 1, level: 'ERROR' }),
    makeListLog(2, { serviceId: 1, level: 'ERROR' }),
    makeListLog(3, { serviceId: 1, level: 'INFO' }),
    makeListLog(4, { serviceId: 2, level: 'ERROR', traceId: 't' }),
    makeListLog(5, { serviceId: 3, level: 'FATAL' }),
  ];

  afterEach(() => app.close());

  it('200 with exactly total/groups over every service, inactive included, in order', async () => {
    await build(mixed());
    const res = await get('/api/logs/stats');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
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
    await build();
    const res = await get('/api/logs/stats');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ total: 0, groups: [] });
  });

  it.each([
    ['missing', {}],
    ['unknown', { 'x-api-key': 'nope' }],
    ['inactive', { 'x-api-key': 'k-off' }],
  ])('%s key is the same 401', async (_label, h) => {
    await build(mixed());
    const res = await get('/api/logs/stats', h);
    expect(res.statusCode).toBe(401);
    expect(stats(res).error.code).toBe('UNAUTHORIZED');
  });

  it('filters are forwarded and narrow the counts', async () => {
    await build(mixed());
    const only = async (query: string) => stats(await get(`/api/logs/stats?${query}`)).total;
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
    await build();
    const res = await get(`/api/logs/stats?${query}`);
    expect(res.statusCode).toBe(400);
    expect(stats(res).error.code).toBe('VALIDATION_ERROR');
    expect(stats(res).error.details?.length).toBeGreaterThan(0);
  });

  it('from equal to to is accepted', async () => {
    await build();
    const res = await get('/api/logs/stats?from=2026-01-01T00:00:00Z&to=2026-01-01T00:00:00Z');
    expect(res.statusCode).toBe(200);
  });

  it('500 on repository failure without leaking internals', async () => {
    const repo = new InMemoryLogRepository();
    repo.countByServiceAndLevel = () => Promise.reject(new Error('secret db detail'));
    await build([], repo);
    const res = await get('/api/logs/stats');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  it('500 without leaking internals when a group references a service missing from the service repository', async () => {
    const repo = new InMemoryLogRepository();
    repo.countByServiceAndLevel = () => Promise.resolve([{ serviceId: 99, level: 'ERROR', count: 1 }]);
    await build([], repo);
    const res = await get('/api/logs/stats');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(res.body).not.toContain('service 99');
  });

});
