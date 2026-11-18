import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { RouteDefinition } from '@/routes/mount-routes.js';
import { InMemoryServiceRepository } from '@/repositories/in-memory-service.repository.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import { buildTestApp } from '@tests/support/apps/express-test-app.js';

const findByApiKey = vi.fn(() => Promise.resolve(null));
const repo: ServiceRepository = { findByApiKey, findNamesByIds: () => Promise.resolve(new Map()) };

const echo: RouteDefinition = {
  method: 'post',
  path: '/echo',
  summary: 'Echo the message',
  tags: ['test'],
  request: { body: z.object({ message: z.string() }) },
  responses: { 200: z.object({ message: z.string() }) },
  handler: (req, res) => void res.json(req.body),
};
const app = () => buildTestApp({ serviceRepo: repo, routes: [echo] });

describe('createApp', () => {
  it('/docs is public: it redirects to /docs/ and serves HTML, without querying the repository', async () => {
    const redirect = await request(app()).get('/docs');
    expect(redirect.status).toBe(301);
    const res = await request(app()).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('/docs/json is public and serves the OpenAPI document', async () => {
    const res = await request(app()).get('/docs/json');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ openapi: expect.any(String) as string, info: { title: 'SmartLog Analyzer API' } });
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('any other /docs path is a 404 envelope, not 401 and not a swagger file', async () => {
    for (const path of ['/docs/x', '/docs/yaml']) {
      const res = await request(app()).get(path);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });

  it('sends neither X-Powered-By nor an ETag', async () => {
    const res = await request(app()).get('/docs/json');
    expect(res.headers).not.toHaveProperty('x-powered-by');
    expect(res.headers).not.toHaveProperty('etag');
  });

  it('routing is strict and case sensitive: /api/echo/ and /API/echo are 404', async () => {
    for (const path of ['/api/echo/', '/API/echo']) {
      const res = await request(app()).post(path).set('x-api-key', 'k').send({ message: 'x' });
      expect(res.status).toBe(404);
    }
  });

  it('an unknown route is a 404 envelope', async () => {
    const res = await request(app()).get('/');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('the x-api-key header never reaches the logs', async () => {
    const lines: string[] = [];
    const logged = buildTestApp({
      serviceRepo: new InMemoryServiceRepository([{ id: 1, name: 's', description: null, apiKey: 'secret-key', isActive: true }]),
      routes: [echo],
      logStream: { write: (m) => lines.push(m) },
    });
    const res = await request(logged).post('/api/echo').set('x-api-key', 'secret-key').send({ message: 'x' });
    expect(res.status).toBe(200);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('secret-key');
  });

  it('reuses the x-request-id of the caller in its logs, or makes one up', async () => {
    const lines: string[] = [];
    const logged = buildTestApp({ serviceRepo: repo, routes: [echo], logStream: { write: (m) => lines.push(m) } });
    await request(logged).get('/nope').set('x-request-id', 'caller-id');
    await request(logged).get('/nope');
    const ids = lines.map((l) => (JSON.parse(l) as { req?: { id?: unknown } }).req?.id).filter(Boolean);
    expect(ids).toContain('caller-id');
    expect(new Set(ids).size).toBeGreaterThan(1);
  });
});
