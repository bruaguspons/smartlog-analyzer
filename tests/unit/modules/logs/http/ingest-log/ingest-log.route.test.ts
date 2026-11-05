import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app/build-app.js';
import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';
import { createLogsRoutes } from '@/modules/logs/http/create-logs-routes.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '@/modules/services/domain/service.types.js';
import { InMemoryServiceRepository } from '@/modules/services/infrastructure/in-memory-service-repository.js';

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
