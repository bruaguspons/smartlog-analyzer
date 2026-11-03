import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app.js';
import type { ServiceRepository } from '../../src/modules/services/domain/service-repository.js';

const findByApiKey = vi.fn(() => Promise.resolve(null));
const repo: ServiceRepository = { findByApiKey };

const apiRoutes: FastifyPluginAsyncZod = (api) => {
  api.post('/echo', { schema: { body: z.object({ message: z.string() }) } }, (req) => req.body);
  return Promise.resolve();
};

describe('buildApp', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    findByApiKey.mockClear();
    await app.close();
  });

  const build = (logStream?: { write(m: string): void }) => {
    app = buildApp({
      serviceRepository: repo,
      apiRoutes: [apiRoutes],
      logLevel: logStream ? 'info' : 'silent',
      ...(logStream && { logStream }),
    });
    return app;
  };

  it('S-AD-1: /docs is public (redirect to /docs/ then HTML), repo not queried', async () => {
    build();
    const first = await app.inject({ method: 'GET', url: '/docs' });
    const res = first.statusCode >= 300 && first.statusCode < 400
      ? await app.inject({ method: 'GET', url: String(first.headers.location) })
      : first;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('S-AD-2: /docs/json is public', async () => {
    build();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('S-AD-3: the OpenAPI document declares the X-API-Key scheme', async () => {
    build();
    await app.ready();
    const doc = app.swagger() as { components?: { securitySchemes?: Record<string, unknown> } };
    expect(doc.components?.securitySchemes?.apiKey).toEqual({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
  });

  it('S-AD-4: zod route schemas are reflected in the OpenAPI paths', async () => {
    build();
    await app.ready();
    const doc = app.swagger() as { paths?: Record<string, { post?: { requestBody?: unknown } }> };
    const requestBody = JSON.stringify(doc.paths?.['/api/echo']?.post?.requestBody);
    expect(requestBody).toContain('message');
    expect(Object.keys(doc.paths ?? {}).some((p) => p.startsWith('/docs'))).toBe(false);
  });

  it('S-AD-5: unknown /docs/x is a 404 envelope, not 401', async () => {
    build();
    const res = await app.inject({ method: 'GET', url: '/docs/x' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('S-HH-1: the x-api-key header never reaches the logs', () => {
    const lines: string[] = [];
    build({ write: (m) => lines.push(m) });
    // Fastify's default req serializer already drops headers; `redact` is defense in depth
    // for any custom serializer that would expose them.
    app.log.info({ req: { headers: { 'x-api-key': 'secret-key' } } }, 'probe');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('secret-key');
  });

  it('S-HH-2: an incoming x-request-id becomes request.id', async () => {
    build();
    app.get('/rid-root', (req) => ({ id: req.id }));
    const res = await app.inject({ method: 'GET', url: '/rid-root', headers: { 'x-request-id': 'abc-1' } });
    expect(res.json()).toEqual({ id: 'abc-1' });
  });

  it('S-HH-3: bodyLimit is explicitly 1 MiB', () => {
    build();
    expect(app.initialConfig.bodyLimit).toBe(1_048_576);
  });
});
