import { symbols } from 'pino';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '@/app.js';
import { serviceRepository } from '@/repositories/service.repository.js';
import { logger } from '@/shared/logger.js';

type Doc = {
  paths: Record<string, Record<string, { security?: unknown; parameters?: { name: string; in: string }[] }>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
};

/** Raises the real logger to `trace` and collects what it writes, restoring both afterwards. */
function captureLogs(): string[] {
  const lines: string[] = [];
  const stream = (logger as unknown as Record<symbol, { write(msg: string): void }>)[symbols.streamSym]!;
  vi.spyOn(stream, 'write').mockImplementation((msg) => void lines.push(msg));
  const previous = logger.level;
  logger.level = 'trace';
  restoreLevel = () => void (logger.level = previous);
  return lines;
}
let restoreLevel = () => undefined;

afterEach(() => {
  restoreLevel();
  restoreLevel = () => undefined;
  vi.restoreAllMocks();
});

describe('docs', () => {
  it('/docs is public: it redirects to /docs/ and serves HTML, without querying the repository', async () => {
    const findByApiKey = vi.spyOn(serviceRepository, 'findByApiKey');
    const redirect = await request(app).get('/docs');
    expect(redirect.status).toBe(301);
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('/docs/json is public and serves the OpenAPI document', async () => {
    const findByApiKey = vi.spyOn(serviceRepository, 'findByApiKey');
    const res = await request(app).get('/docs/json');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ openapi: expect.any(String) as string, info: { title: 'SmartLog Analyzer API' } });
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('any other /docs path is a 404 envelope, not 401 and not a swagger file', async () => {
    for (const path of ['/docs/x', '/docs/yaml']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });

  describe('document', () => {
    const document = async () => (await request(app).get('/docs/json')).body as Doc;

    it('declares the X-API-Key scheme and lists every route of the three routers', async () => {
      const doc = await document();
      expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
      expect(Object.keys(doc.paths)).toEqual(['/api/health', '/api/logs', '/api/logs/stats', '/api/logs/analyze', '/api/analysis/{id}']);
      expect(doc.paths['/api/analysis/{id}']?.get?.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path' })]);
    });

    it('documents the filters as query parameters, and no /docs path', async () => {
      const doc = await document();
      const names = doc.paths['/api/logs']?.get?.parameters?.map((p) => p.name);
      expect(names).toEqual(expect.arrayContaining(['serviceId', 'level', 'from', 'to', 'traceId', 'search', 'limit', 'cursor']));
      expect(Object.keys(doc.paths).some((p) => p.startsWith('/docs'))).toBe(false);
    });

    it('marks only the health route as public', async () => {
      const doc = await document();
      expect(doc.paths['/api/health']?.get?.security).toEqual([]);
      for (const [path, methods] of Object.entries(doc.paths)) {
        if (path !== '/api/health') for (const op of Object.values(methods)) expect(op.security).toBeUndefined();
      }
    });

    it('publishes the JSON value as a named component', async () => {
      expect(Object.keys((await document()).components.schemas)).toContain('JsonValue');
    });
  });
});

describe('app settings', () => {
  it('sends neither X-Powered-By nor an ETag', async () => {
    const res = await request(app).get('/docs/json');
    expect(res.headers).not.toHaveProperty('x-powered-by');
    expect(res.headers).not.toHaveProperty('etag');
  });

  it('routing is strict and case sensitive: /api/health/ and /API/health are 404', async () => {
    for (const path of ['/api/health/', '/API/health']) {
      expect((await request(app).get(path)).status).toBe(404);
    }
  });

  it('an unknown route is a 404 envelope, and an unknown /api route needs no key', async () => {
    const root = await request(app).get('/');
    expect(root.status).toBe(404);
    expect(root.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
    expect((await request(app).get('/api/nope')).status).toBe(404);
  });
});

describe('request logging', () => {
  it('the x-api-key header never reaches the logs', async () => {
    const lines = captureLogs();
    vi.spyOn(serviceRepository, 'findByApiKey').mockResolvedValue(null);
    const res = await request(app).get('/api/logs').set('x-api-key', 'secret-key');
    expect(res.status).toBe(401);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('secret-key');
  });

  it('reuses the x-request-id of the caller in its logs, or makes one up', async () => {
    const lines = captureLogs();
    await request(app).get('/nope').set('x-request-id', 'caller-id');
    await request(app).get('/nope');
    const ids = lines.map((l) => (JSON.parse(l) as { req?: { id?: unknown } }).req?.id).filter(Boolean);
    expect(ids).toContain('caller-id');
    expect(new Set(ids).size).toBeGreaterThan(1);
  });
});
