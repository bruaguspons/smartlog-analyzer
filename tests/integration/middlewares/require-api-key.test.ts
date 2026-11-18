import type { RequestHandler, Router } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Service } from '@/models/service.js';
import { serviceRepository } from '@/repositories/service.repository.js';
import { parseJsonBody } from '@/middlewares/parse-json-body.js';
import { requireApiKey } from '@/middlewares/require-api-key.js';
import { prisma } from '@/shared/db/prisma.js';
import { buildTestApp } from '@tests/support/apps/express-test-app.js';
import { makeService } from '@tests/support/fixtures.js';
import { resetDatabase } from '@tests/support/integration/database.js';

const active = makeService(7, { apiKey: 'k-active' });
const off = makeService(8, { apiKey: 'k-off', isActive: false });

/** Stores the given services and spies the real repository's lookup so a test can count queries. */
async function seedServices(services: Service[] = [active, off]) {
  await resetDatabase();
  await prisma.service.createMany({ data: services });
  return vi.spyOn(serviceRepository, 'findByApiKey');
}

beforeAll(async () => {
  await prisma.$connect();
});

afterEach(() => {
  vi.restoreAllMocks();
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

const mount = (router: Router) => {
  router.get('/p', requireApiKey, handler);
  router.post('/v', requireApiKey, parseJsonBody(), handler);
  router.get('/open', (_req, res) => void res.json({ ok: true }));
};

describe('requireApiKey against Postgres', () => {
  const build = (logStream?: { write(m: string): void }) => buildTestApp({ mount, ...(logStream && { logStream }) });

  it('a valid key puts the service in res.locals; the repository is queried once', async () => {
    const findByApiKey = await seedServices();
    handler.mockClear();
    const res = await request(build()).get('/api/p').set('x-api-key', 'k-active');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7 });
    expect(findByApiKey).toHaveBeenCalledTimes(1);
  });

  it('missing, empty, too long, unknown and inactive give an identical 401', async () => {
    await seedServices();
    handler.mockClear();
    const app = build();
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
    const findByApiKey = await seedServices();
    await request(build()).get('/api/p').set('x-api-key', 'k'.repeat(256));
    expect(findByApiKey).toHaveBeenCalledTimes(1);
  });

  it('an unknown /api route without key is 404 and the repository is not queried', async () => {
    const findByApiKey = await seedServices();
    const res = await request(build()).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('an unknown /api route with a valid key is 404 too', async () => {
    await seedServices();
    const res = await request(build()).get('/api/nope').set('x-api-key', 'k-active');
    expect(res.status).toBe(404);
  });

  it('a public route needs no key and skips the repository', async () => {
    const findByApiKey = await seedServices();
    const res = await request(build()).get('/api/open');
    expect(res.status).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('auth precedes body validation', async () => {
    await seedServices([]);
    const res = await request(build()).post('/api/v').send({});
    expect(res.status).toBe(401);
  });

  it('an empty repository gives 401 for any key', async () => {
    await seedServices([]);
    const res = await request(build()).get('/api/p').set('x-api-key', 'k-active');
    expect(res.status).toBe(401);
  });

  it('the API key never reaches the logs', async () => {
    const lines: string[] = [];
    const secret = 'k-secret-should-not-be-logged';
    await seedServices([{ ...active, apiKey: secret }]);
    const app = build({ write: (msg) => lines.push(msg) });
    const ok = await request(app).get('/api/p').set('x-api-key', secret);
    const denied = await request(app).get('/api/p').set('x-api-key', `${secret}-x`);
    expect([ok.status, denied.status]).toEqual([200, 401]);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain(secret);
  });

  it('a repository failure is fail-closed: 500 INTERNAL_ERROR, nothing leaked', async () => {
    vi.spyOn(serviceRepository, 'findByApiKey').mockRejectedValue(new Error('db password=secret'));
    const res = await request(build()).get('/api/p').set('x-api-key', 'k');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(res.text).not.toContain('secret');
  });
});
