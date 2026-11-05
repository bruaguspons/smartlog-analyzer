import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildApp } from '@/app/build-app.js';
import type { ServiceRepository } from '@/modules/services/domain/service-repository.types.js';

const dbOk = () => Promise.resolve();

const findByApiKey = vi.fn(() => Promise.resolve(null));
const repo: ServiceRepository = { findByApiKey, findNamesByIds: () => Promise.resolve(new Map()) };

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
      checkDatabase: dbOk,
      apiRoutes: [apiRoutes],
      logLevel: logStream ? 'info' : 'silent',
      ...(logStream && { logStream }),
    });
    return app;
  };

  it('/docs is public (redirect to /docs/ then HTML), repo not queried', async () => {
    build();
    const first = await app.inject({ method: 'GET', url: '/docs' });
    const res = first.statusCode >= 300 && first.statusCode < 400
      ? await app.inject({ method: 'GET', url: String(first.headers.location) })
      : first;
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('/docs/json is public', async () => {
    build();
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('the OpenAPI document declares the X-API-Key scheme', async () => {
    build();
    await app.ready();
    const doc = app.swagger() as { components?: { securitySchemes?: Record<string, unknown> } };
    expect(doc.components?.securitySchemes?.apiKey).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
  });

  it('zod route schemas are reflected in the OpenAPI paths', async () => {
    build();
    await app.ready();
    const doc = app.swagger() as { paths?: Record<string, { post?: { requestBody?: unknown } }> };
    const requestBody = JSON.stringify(doc.paths?.['/api/echo']?.post?.requestBody);
    expect(requestBody).toContain('message');
    expect(Object.keys(doc.paths ?? {}).some((p) => p.startsWith('/docs'))).toBe(false);
  });

  it('unknown /docs/x is a 404 envelope, not 401', async () => {
    build();
    const res = await app.inject({ method: 'GET', url: '/docs/x' });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('the x-api-key header never reaches the logs', () => {
    const lines: string[] = [];
    build({ write: (m) => lines.push(m) });
    // Fastify's default req serializer already drops headers; `redact` is defense in depth
    // for any custom serializer that would expose them.
    app.log.info({ req: { headers: { 'x-api-key': 'secret-key' } } }, 'probe');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('secret-key');
  });

});
