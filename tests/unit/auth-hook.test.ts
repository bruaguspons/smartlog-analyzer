import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app.js';
import type { Service } from '../../src/modules/services/domain/service.js';
import type { ServiceRepository } from '../../src/modules/services/domain/service-repository.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';

const dbOk = () => Promise.resolve();

const active: Service = { id: 7, name: 'svc', description: null, apiKey: 'k-active', isActive: true };
const off: Service = { id: 8, name: 'off', description: null, apiKey: 'k-off', isActive: false };

function spiedRepo(services: Service[] = [active, off]) {
  const inner = new InMemoryServiceRepository(services);
  const findByApiKey = vi.fn((key: string) => inner.findByApiKey(key));
  return { repo: { findByApiKey, findNamesByIds: (ids: readonly number[]) => inner.findNamesByIds(ids) } satisfies ServiceRepository, findByApiKey };
}

describe('auth hook (/api scope)', () => {
  let app: FastifyInstance;
  const handler = vi.fn((req: { service: Service | null }) => ({ id: req.service?.id }));

  const testRoutes: FastifyPluginAsyncZod = async (api) => {
    api.get('/p', handler);
    api.post('/v', { schema: { body: z.object({ a: z.string() }) } }, () => ({}));
    await api.register((child, _opts, done) => {
      child.get('/nested', () => ({ nested: true }));
      done();
    });
  };

  afterEach(async () => {
    handler.mockClear();
    await app.close();
  });

  function build(repo: ServiceRepository, logLevel: 'silent' | 'trace' = 'silent', logStream?: { write(m: string): void }) {
    app = buildApp({
      serviceRepository: repo,
      checkDatabase: dbOk,
      apiRoutes: [testRoutes],
      logLevel,
      ...(logStream && { logStream }),
    });
    return app;
  }

  it('valid key attaches the service; repo queried once', async () => {
    const { repo, findByApiKey } = spiedRepo();
    const res = await build(repo).inject({ method: 'GET', url: '/api/p', headers: { 'x-api-key': 'k-active' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 7 });
    expect(findByApiKey).toHaveBeenCalledTimes(1);
  });

  it('missing, empty, unknown and inactive give an identical 401', async () => {
    const { repo } = spiedRepo();
    build(repo);
    const headersList: Record<string, string>[] = [{}, { 'x-api-key': '' }, { 'x-api-key': 'nope' }, { 'x-api-key': 'k-off' }];
    const responses = [];
    for (const headers of headersList) {
      responses.push(await app.inject({ method: 'GET', url: '/api/p', headers }));
    }
    for (const res of responses) {
      expect(res.statusCode).toBe(401);
      const body = res.json<{ error: Record<string, unknown> }>();
      expect(body.error.code).toBe('UNAUTHORIZED');
      expect('details' in body.error).toBe(false);
      expect(res.body).not.toContain('nope');
      expect(res.body).not.toContain('k-off');
    }
    expect(new Set(responses.map((r) => r.body)).size).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('unknown /api route without key is 404; repo not queried', async () => {
    const { repo, findByApiKey } = spiedRepo();
    const res = await build(repo).inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('unknown /api route with valid key is 404', async () => {
    const { repo } = spiedRepo();
    const res = await build(repo).inject({ method: 'GET', url: '/api/nope', headers: { 'x-api-key': 'k-active' } });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('unknown root route is 404', async () => {
    const { repo } = spiedRepo();
    const res = await build(repo).inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
  });

  it('a root route registered outside the scope needs no key and skips the repo', async () => {
    const { repo, findByApiKey } = spiedRepo();
    build(repo).get('/api/open', () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/api/open' });
    expect(res.statusCode).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('auth precedes body validation', async () => {
    const res = await build(new InMemoryServiceRepository()).inject({ method: 'POST', url: '/api/v', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('empty repository gives 401 for any key', async () => {
    const res = await build(new InMemoryServiceRepository()).inject({
      method: 'GET',
      url: '/api/p',
      headers: { 'x-api-key': 'k-active' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('buildApp without serviceRepository is a type error and fails at boot', async () => {
    // @ts-expect-error serviceRepository is required (fail-closed)
    app = buildApp({ logLevel: 'silent' });
    await expect(app.ready()).rejects.toThrow(TypeError);
  });

  it('nested plugins inside the scope inherit the hook', async () => {
    const res = await build(new InMemoryServiceRepository()).inject({ method: 'GET', url: '/api/nested' });
    expect(res.statusCode).toBe(401);
  });

  it('the API key never reaches the logs', async () => {
    const lines: string[] = [];
    const secret = 'k-secret-should-not-be-logged';
    build(
      new InMemoryServiceRepository([{ ...active, apiKey: secret }]),
      'trace',
      { write: (msg) => lines.push(msg) },
    );
    const ok = await app.inject({ method: 'GET', url: '/api/p', headers: { 'x-api-key': secret } });
    const denied = await app.inject({ method: 'GET', url: '/api/p', headers: { 'x-api-key': `${secret}-x` } });
    expect([ok.statusCode, denied.statusCode]).toEqual([200, 401]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(secret);
  });

  it('repository failure is fail-closed: 500 INTERNAL_ERROR, nothing leaked', async () => {
    const repo: ServiceRepository = {
      findByApiKey: () => Promise.reject(new Error('db password=secret')),
      findNamesByIds: () => Promise.resolve(new Map()),
    };
    const res = await build(repo).inject({ method: 'GET', url: '/api/p', headers: { 'x-api-key': 'k' } });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('secret');
  });
});
