import type { RequestHandler } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Service } from '@/models/service.js';
import { serviceRepository, type ServiceRepository } from '@/repositories/service.repository.js';
import { requireApiKey } from '@/middlewares/require-api-key.js';
import type { RouteDefinition } from '@/routes/mount-routes.js';
import { prisma } from '@/shared/db/prisma.js';
import { buildTestApp } from '@tests/support/apps/express-test-app.js';
import { makeService } from '@tests/support/fixtures.js';
import { resetDatabase } from '@tests/support/integration/database.js';

const active = makeService(7, { apiKey: 'k-active' });
const off = makeService(8, { apiKey: 'k-off', isActive: false });

/** The real repository over Postgres, with `findByApiKey` spied so a test can count lookups. */
async function spiedRepo(services: Service[] = [active, off]) {
  await resetDatabase();
  await prisma.service.createMany({ data: services });
  const inner = serviceRepository;
  const findByApiKey = vi.fn((key: string) => inner.findByApiKey(key));
  return { repo: { findByApiKey, findNamesByIds: (ids: readonly number[]) => inner.findNamesByIds(ids) } satisfies ServiceRepository, findByApiKey };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

const handler = vi.fn<RequestHandler>((_req, res) => {
  res.json({ id: res.locals.service.id });
});

const routes: RouteDefinition[] = [
  { method: 'get', path: '/p', summary: 'protected', tags: [], responses: { 200: z.object({ id: z.number() }) }, handler },
  { method: 'post', path: '/v', summary: 'with body', tags: [], request: { body: z.object({ a: z.string() }) }, responses: { 200: z.object({}) }, handler },
  { method: 'get', path: '/open', summary: 'public', tags: [], public: true, responses: { 200: z.object({}) }, handler: (_req, res) => void res.json({ ok: true }) },
];

describe('requireApiKey against Postgres', () => {
  const build = (repo: ServiceRepository, logStream?: { write(m: string): void }) =>
    buildTestApp({ serviceRepo: repo, routes, ...(logStream && { logStream }) });

  it('a valid key puts the service in res.locals; the repository is queried once', async () => {
    const { repo, findByApiKey } = await spiedRepo();
    handler.mockClear();
    const res = await request(build(repo)).get('/api/p').set('x-api-key', 'k-active');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7 });
    expect(findByApiKey).toHaveBeenCalledTimes(1);
  });

  it('missing, empty, too long, unknown and inactive give an identical 401', async () => {
    const { repo } = await spiedRepo();
    handler.mockClear();
    const app = build(repo);
    const responses = [
      await request(app).get('/api/p'),
      await request(app).get('/api/p').set('x-api-key', ''),
      await request(app).get('/api/p').set('x-api-key', 'k'.repeat(257)),
      await request(app).get('/api/p').set('x-api-key', 'nope'),
      await request(app).get('/api/p').set('x-api-key', 'k-off'),
    ];
    for (const res of responses) {
      expect(res.status).toBe(401);
      const { error } = res.body as { error: Record<string, unknown> };
      expect(error.code).toBe('UNAUTHORIZED');
      expect('details' in error).toBe(false);
      expect(res.text).not.toContain('nope');
      expect(res.text).not.toContain('k-off');
    }
    expect(new Set(responses.map((r) => r.text)).size).toBe(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('a key of exactly 256 characters is still looked up', async () => {
    const { repo, findByApiKey } = await spiedRepo();
    await request(build(repo)).get('/api/p').set('x-api-key', 'k'.repeat(256));
    expect(findByApiKey).toHaveBeenCalledTimes(1);
  });

  it('an unknown /api route without key is 404 and the repository is not queried', async () => {
    const { repo, findByApiKey } = await spiedRepo();
    const res = await request(build(repo)).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('an unknown /api route with a valid key is 404 too', async () => {
    const { repo } = await spiedRepo();
    const res = await request(build(repo)).get('/api/nope').set('x-api-key', 'k-active');
    expect(res.status).toBe(404);
  });

  it('a public route needs no key and skips the repository', async () => {
    const { repo, findByApiKey } = await spiedRepo();
    const res = await request(build(repo)).get('/api/open');
    expect(res.status).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('auth precedes body validation', async () => {
    const res = await request(build((await spiedRepo([])).repo)).post('/api/v').send({});
    expect(res.status).toBe(401);
  });

  it('an empty repository gives 401 for any key', async () => {
    const res = await request(build((await spiedRepo([])).repo)).get('/api/p').set('x-api-key', 'k-active');
    expect(res.status).toBe(401);
  });

  it('is a TypeError at boot without a repository', () => {
    expect(() => requireApiKey(undefined as unknown as ServiceRepository)).toThrow(TypeError);
  });

  it('the API key never reaches the logs', async () => {
    const lines: string[] = [];
    const secret = 'k-secret-should-not-be-logged';
    const app = build((await spiedRepo([{ ...active, apiKey: secret }])).repo, { write: (msg) => lines.push(msg) });
    const ok = await request(app).get('/api/p').set('x-api-key', secret);
    const denied = await request(app).get('/api/p').set('x-api-key', `${secret}-x`);
    expect([ok.status, denied.status]).toEqual([200, 401]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(secret);
  });

  it('a repository failure is fail-closed: 500 INTERNAL_ERROR, nothing leaked', async () => {
    const repo: ServiceRepository = {
      findByApiKey: () => Promise.reject(new Error('db password=secret')),
      findNamesByIds: () => Promise.resolve(new Map()),
    };
    const res = await request(build(repo)).get('/api/p').set('x-api-key', 'k');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(res.text).not.toContain('secret');
  });
});
