import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RouteDefinition } from '@/routes/mount-routes.js';
import { createHealthController } from '@/controllers/health.controller.js';
import { healthResponseSchema } from '@/schemas/health.schema.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import { buildTestApp } from '@tests/support/apps/express-test-app.js';

const findByApiKey = vi.fn(() => Promise.resolve(null));
const serviceRepo: ServiceRepository = { findByApiKey, findNamesByIds: () => Promise.resolve(new Map()) };

function build(checkDatabase: () => Promise<void>) {
  const route: RouteDefinition = {
    method: 'get',
    path: '/health',
    summary: 'health',
    tags: [],
    public: true,
    responses: { 200: healthResponseSchema },
    handler: createHealthController({ checkDatabase }).health,
  };
  return buildTestApp({ serviceRepo, routes: [route] });
}

describe('GET /api/health', () => {
  afterEach(() => {
    vi.useRealTimers();
    findByApiKey.mockClear();
  });

  it('returns 200 ok when the database answers, without an API key', async () => {
    const checkDatabase = vi.fn(() => Promise.resolve());
    const res = await request(build(checkDatabase)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    expect(checkDatabase).toHaveBeenCalledTimes(1);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('ignores an invalid API key (public route)', async () => {
    const res = await request(build(() => Promise.resolve())).get('/api/health').set('x-api-key', 'unknown');
    expect(res.status).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('returns 503 SERVICE_UNAVAILABLE in the error envelope when the database fails', async () => {
    const res = await request(build(() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')))).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unreachable', details: { database: 'unreachable' } },
    });
    expect(res.text).not.toContain('ECONNREFUSED');
  });

  it('keeps waiting at 1999 ms and answers 503 at 2000 ms when the database check hangs', async () => {
    let reached!: () => void;
    const checkReached = new Promise<void>((resolve) => (reached = resolve));
    const app = build(() => {
      reached();
      return new Promise<void>(() => undefined);
    });
    const server = app.listen(0);
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let settled = false;
      const pending = request(server).get('/api/health').then((res) => {
        settled = true;
        return res;
      });
      // The timeout is armed right before the check is called, so from here the fake clock decides.
      await checkReached;
      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      vi.useRealTimers();
      server.close();
    }
  });
});
