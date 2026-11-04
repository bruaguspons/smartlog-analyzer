import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { LogRepository } from '../../src/modules/logs/domain/log-repository.js';
import { createLogsRoutes } from '../../src/modules/logs/http/logs-routes.js';
import { InMemoryLogRepository } from '../../src/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '../../src/modules/services/domain/service.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';
import { randomUUIDv7 } from 'node:crypto';
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
    app = buildApp({
      serviceRepository: new InMemoryServiceRepository([active, off]),
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [createLogsRoutes({ repo, newId, now: () => NOW })],
      logLevel: 'silent',
    });
    return app;
  }

  afterEach(() => app.close());

  const post = (payload: unknown, h: Record<string, string> = headers) =>
    app.inject({ method: 'POST', url: '/api/logs', headers: h, payload: payload as object });

  it('S1/S21: 201 with exactly the seven camelCase keys and the generated id', async () => {
    build(undefined, () => ID);
    const body = { ...valid, traceId: 't-1', metadata: { a: 1 } };

    const res = await post(body);

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: ID, serviceId: 7, ...body });
    expect(Object.keys(json(res)).sort()).toEqual(
      ['id', 'level', 'message', 'metadata', 'serviceId', 'timestamp', 'traceId'],
    );
  });

  it('S2: absent optionals are null', async () => {
    build();
    const res = await post(valid);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ traceId: null, metadata: null });
  });

  it('S11: normalizes an offset timestamp to UTC', async () => {
    build();
    const res = await post({ ...valid, timestamp: '2026-11-03T08:00:00-03:00' });
    expect(res.statusCode).toBe(201);
    expect(json(res).timestamp).toBe('2026-11-03T11:00:00.000Z');
  });

  it('S22: default generator yields a UUIDv7', async () => {
    build(undefined, randomUUIDv7);
    const res = await post(valid);
    expect(json(res).id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('S23: persists through the repository port, attributed to the key service', async () => {
    const repo = new InMemoryLogRepository();
    build(repo);
    const res = await post(valid);
    expect(repo.logs).toHaveLength(1);
    expect(repo.logs[0]).toMatchObject({ id: ID, serviceId: 7, message: 'boom' });
    expect({ ...res.json(), timestamp: new Date(json(res).timestamp) }).toEqual(repo.logs[0]);
  });

  it('S3: body serviceId is rejected and nothing is persisted', async () => {
    const repo = new InMemoryLogRepository();
    build(repo);
    const res = await post({ ...valid, serviceId: 9 });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.code).toBe('VALIDATION_ERROR');
    expect(repo.logs).toHaveLength(0);
  });

  it('S5: missing key with an invalid body is 401, not 400', async () => {
    const repo = new InMemoryLogRepository();
    build(repo);
    const res = await post({ nope: true }, {});
    expect(res.statusCode).toBe(401);
    expect(repo.logs).toHaveLength(0);
  });

  it('S6: inactive and unknown keys give an identical 401', async () => {
    build();
    const a = await post(valid, { 'x-api-key': 'k-off' });
    const b = await post(valid, { 'x-api-key': 'nope' });
    expect(a.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it('S10: future skew gives 400 with /timestamp in details', async () => {
    build();
    const res = await post({ ...valid, timestamp: new Date(NOW.getTime() + 300_001).toISOString() });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.details).toEqual([expect.objectContaining({ instancePath: '/timestamp' })]);
  });

  it('S18: two invalid fields give two details and persist nothing', async () => {
    const repo = new InMemoryLogRepository();
    build(repo);
    const res = await post({ ...valid, level: 'x', message: '' });
    expect(res.statusCode).toBe(400);
    expect(json(res).error.details).toHaveLength(2);
    expect(repo.logs).toHaveLength(0);
  });

  it('S19: malformed JSON is a 400 VALIDATION_ERROR', async () => {
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

  it('S20: a body over 1 MiB is a 413 PAYLOAD_TOO_LARGE', async () => {
    build();
    const res = await post({ ...valid, message: 'a'.repeat(1_048_577) });
    expect(res.statusCode).toBe(413);
    expect(json(res).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('500 on repository failure without leaking internals', async () => {
    build({
      create: () => Promise.reject(new Error('secret db detail')),
      list: () => Promise.reject(new Error('not used')),
    });
    const res = await post(valid);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(res.body).not.toContain('secret');
  });

  it('documents the route in OpenAPI', async () => {
    build();
    await app.ready();
    expect(Object.keys(app.swagger().paths ?? {})).toContain('/api/logs');
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
    app = buildApp({
      serviceRepository: new InMemoryServiceRepository([A, B, OFF]),
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [createLogsRoutes({ repo, newId: () => ID, now: () => NOW })],
      logLevel: 'silent',
    });
    return repo;
  }
  const get = (url: string, h: Record<string, string> = keyA) => app.inject({ method: 'GET', url, headers: h });

  afterEach(() => app.close());

  it('S1: 200 with exactly items/nextCursor/hasMore and the seven camelCase item keys', async () => {
    await build(1);
    const res = await get('/api/logs');
    expect(res.statusCode).toBe(200);
    expect(Object.keys(page(res)).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    expect(Object.keys(page(res).items[0] ?? {}).sort()).toEqual(
      ['id', 'level', 'message', 'metadata', 'serviceId', 'timestamp', 'traceId'],
    );
  });

  it('S2: empty result', async () => {
    await build();
    const res = await get('/api/logs');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [], nextCursor: null, hasMore: false });
  });

  it('S5/S6: lists every service; serviceId only filters', async () => {
    await build(4);
    expect(page(await get('/api/logs')).items.map((i) => i.serviceId).sort()).toEqual([1, 1, 2, 2]);
    expect(page(await get('/api/logs?serviceId=2')).items.map((i) => i.serviceId)).toEqual([2, 2]);
  });

  it('S17/S18: repeated and single level', async () => {
    await build(4);
    expect(page(await get('/api/logs?level=ERROR')).items).toHaveLength(2);
    expect(page(await get('/api/logs?level=ERROR&level=FATAL')).items).toHaveLength(4);
  });

  it('S10: follows nextCursor until null', async () => {
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

  it('S3/S4: missing, unknown and inactive keys give the same 401, before validation', async () => {
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
  ])('S39: %s is a 400 VALIDATION_ERROR with a details list', async (query) => {
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

  it('documents GET /api/logs in OpenAPI', async () => {
    await build();
    await app.ready();
    const op = app.swagger().paths?.['/api/logs']?.get;
    expect(op).toBeDefined();
    expect(Object.keys(op?.responses ?? {})).toEqual(expect.arrayContaining(['200']));
  });
});
