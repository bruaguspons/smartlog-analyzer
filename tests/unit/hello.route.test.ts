import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';

describe('GET /api/hello', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with the exact body', async () => {
    app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/api/hello' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: 'Hello, World!' });
  });

  it('does not require X-API-Key', async () => {
    app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/api/hello' });
    expect(res.statusCode).toBe(200);
  });

  it('responds with a JSON content-type', async () => {
    app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/api/hello' });
    expect(res.headers['content-type']).toMatch(/^application\/json/);
  });

  it('returns 404 for unknown routes', async () => {
    app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(res.statusCode).toBe(404);
  });

  it('returns the observed status for POST /api/hello', async () => {
    app = buildApp({ logLevel: 'silent' });
    const res = await app.inject({ method: 'POST', url: '/api/hello' });
    expect(res.statusCode).toBe(404);
  });

  it('closes without having bound a port', async () => {
    app = buildApp({ logLevel: 'silent' });
    await app.inject({ method: 'GET', url: '/api/hello' });
    await expect(app.close()).resolves.toBeUndefined();
  });
});
