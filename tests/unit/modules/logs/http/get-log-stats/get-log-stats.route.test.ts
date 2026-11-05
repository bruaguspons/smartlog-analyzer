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
