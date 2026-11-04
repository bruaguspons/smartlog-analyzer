import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { ServiceRepository } from '../../src/modules/services/domain/service-repository.js';
import { HEALTH_DB_TIMEOUT_MS } from '../../src/shared/http/health-route.js';

const findByApiKey = vi.fn(() => Promise.resolve(null));
const repo: ServiceRepository = { findByApiKey, findNamesByIds: () => Promise.resolve(new Map()) };

describe('GET /api/health', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    vi.useRealTimers();
    findByApiKey.mockClear();
    await app.close();
  });

  const build = (checkDatabase: () => Promise<void>) => {
    app = buildApp({ serviceRepository: repo, checkDatabase, logLevel: 'silent' });
    return app;
  };

  it('returns 200 ok when the database answers, without an API key', async () => {
    const checkDatabase = vi.fn(() => Promise.resolve());
    const res = await build(checkDatabase).inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
    expect(checkDatabase).toHaveBeenCalledTimes(1);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('ignores an invalid API key (public route)', async () => {
    const res = await build(() => Promise.resolve()).inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-api-key': 'unknown' },
    });
    expect(res.statusCode).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('returns 503 SERVICE_UNAVAILABLE in the error envelope when the database fails', async () => {
    const res = await build(() => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432'))).inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unreachable', details: { database: 'unreachable' } },
    });
    expect(res.body).not.toContain('ECONNREFUSED');
  });

  it('returns 503 when the database check hangs past the timeout', async () => {
    await build(() => new Promise<void>(() => undefined)).ready();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pending = app.inject({ method: 'GET', url: '/api/health' });
    await vi.advanceTimersByTimeAsync(HEALTH_DB_TIMEOUT_MS);
    const res = await pending;
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('is documented as public in OpenAPI', async () => {
    build(() => Promise.resolve());
    await app.ready();
    const doc = app.swagger() as { paths?: Record<string, { get?: { security?: unknown } }> };
    expect(doc.paths?.['/api/health']?.get?.security).toEqual([]);
  });
});
