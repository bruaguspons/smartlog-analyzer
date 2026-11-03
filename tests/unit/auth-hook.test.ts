import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { Service } from '../../src/modules/services/domain/service.js';
import type { ServiceRepository } from '../../src/modules/services/domain/service-repository.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';

const active: Service = { id: 7, name: 'svc', description: null, apiKey: 'k-active', isActive: true };
const off: Service = { id: 8, name: 'off', description: null, apiKey: 'k-off', isActive: false };

function spiedRepo(services: Service[] = [active, off]) {
  const inner = new InMemoryServiceRepository(services);
  const findByApiKey = vi.fn((key: string) => inner.findByApiKey(key));
  return { repo: { findByApiKey } satisfies ServiceRepository, findByApiKey };
}

describe('auth hook', () => {
  let app: FastifyInstance;
  const handler = vi.fn((req: { service: Service | null }) => ({ id: req.service?.id }));

  afterEach(async () => {
    handler.mockClear();
    await app.close();
  });

  function build(repo: ServiceRepository) {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
    app.get('/p', handler);
    app.get('/pub', { config: { public: true } }, () => ({ ok: true }));
    return app;
  }

  it('S-SA-1: valid key attaches the service; repo queried once', async () => {
    const { repo, findByApiKey } = spiedRepo();
    const res = await build(repo).inject({ method: 'GET', url: '/p', headers: { 'x-api-key': 'k-active' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 7 });
    expect(findByApiKey).toHaveBeenCalledTimes(1);
  });

  it('S-SA-2..6: missing, empty, unknown and inactive give an identical 401', async () => {
    const { repo } = spiedRepo();
    build(repo);
    const headersList: Record<string, string>[] = [{}, { 'x-api-key': '' }, { 'x-api-key': 'nope' }, { 'x-api-key': 'k-off' }];
    const responses = [];
    for (const headers of headersList) {
      responses.push(await app.inject({ method: 'GET', url: '/p', headers }));
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

  it('S-SA-7: public route needs no key and does not query the repo', async () => {
    const { repo, findByApiKey } = spiedRepo();
    const res = await build(repo).inject({ method: 'GET', url: '/pub' });
    expect(res.statusCode).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('S-SA-9/10: unknown route is 404 with or without key; repo not queried', async () => {
    const { repo, findByApiKey } = spiedRepo();
    build(repo);
    const a = await app.inject({ method: 'GET', url: '/nope' });
    const b = await app.inject({ method: 'GET', url: '/nope', headers: { 'x-api-key': 'k-active' } });
    for (const res of [a, b]) {
      expect(res.statusCode).toBe(404);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
    }
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('request.is404 is true in onRequest for unmatched routes (Fastify 5)', async () => {
    app = buildApp({ serviceRepository: new InMemoryServiceRepository(), logLevel: 'silent' });
    const seen: boolean[] = [];
    app.addHook('onRequest', (request, _reply, done) => {
      seen.push(request.is404);
      done();
    });
    await app.inject({ method: 'GET', url: '/nope' });
    expect(seen).toEqual([true]);
  });

  it('S-SA-11: empty repository gives 401 for any key', async () => {
    const res = await build(new InMemoryServiceRepository()).inject({
      method: 'GET',
      url: '/p',
      headers: { 'x-api-key': 'k-active' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('S-SA-11: buildApp without serviceRepository is a type error and throws at construction', () => {
    // @ts-expect-error serviceRepository is required (fail-closed)
    expect(() => buildApp({ logLevel: 'silent' })).toThrow(TypeError);
    app = buildApp({ serviceRepository: new InMemoryServiceRepository(), logLevel: 'silent' });
  });

  it('S-SA-11: the API key never reaches the logs', async () => {
    const lines: string[] = [];
    const secret = 'k-secret-should-not-be-logged';
    app = buildApp({
      serviceRepository: new InMemoryServiceRepository([{ ...active, apiKey: secret }]),
      logLevel: 'trace',
      logStream: { write: (msg) => lines.push(msg) },
    });
    app.get('/p', handler);
    const ok = await app.inject({ method: 'GET', url: '/p', headers: { 'x-api-key': secret } });
    const denied = await app.inject({ method: 'GET', url: '/p', headers: { 'x-api-key': `${secret}-x` } });
    expect([ok.statusCode, denied.statusCode]).toEqual([200, 401]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(secret);
  });

  it('S-SA-12: auth precedes body validation', async () => {
    app = buildApp({ serviceRepository: new InMemoryServiceRepository(), logLevel: 'silent' });
    app.post('/v', { schema: { body: { type: 'object', required: ['a'] } } }, () => ({}));
    const res = await app.inject({ method: 'POST', url: '/v', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('repository failure is fail-closed: 500 INTERNAL_ERROR, nothing leaked', async () => {
    const repo: ServiceRepository = { findByApiKey: () => Promise.reject(new Error('db password=secret')) };
    const res = await build(repo).inject({ method: 'GET', url: '/p', headers: { 'x-api-key': 'k' } });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('secret');
  });

  it('hook applies to routes in encapsulated child plugins', async () => {
    app = buildApp({ serviceRepository: new InMemoryServiceRepository(), logLevel: 'silent' });
    app.register((child, _opts, done) => {
      child.get('/c', () => ({}));
      done();
    });
    const res = await app.inject({ method: 'GET', url: '/c' });
    expect(res.statusCode).toBe(401);
  });
});
