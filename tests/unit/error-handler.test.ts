import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../../src/app.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { toErrorResponse } from '../../src/shared/http/error-handler.js';

const dbOk = () => Promise.resolve();

const AUTH = { 'x-api-key': 'k-test' };
const repo = new InMemoryServiceRepository([
  { id: 1, name: 'svc', description: null, apiKey: 'k-test', isActive: true },
]);

describe('error envelope', () => {
  let app: FastifyInstance;

  const typed = () => app.withTypeProvider<ZodTypeProvider>();

  afterEach(async () => {
    await app.close();
  });

  it('unknown route -> 404 NOT_FOUND, no details key', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/does-not-exist', headers: AUTH });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = res.json<{ error: Record<string, unknown> }>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect('details' in body.error).toBe(false);
  });

  it('invalid zod body -> 400 with details limited to instancePath/keyword/message', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    typed().post('/v', { schema: { body: z.object({ level: z.enum(['INFO', 'ERROR']) }) } }, () => ({}));
    const res = await app.inject({ method: 'POST', url: '/v', headers: AUTH, payload: { level: 'X' } });
    expect(res.statusCode).toBe(400);
    const { error } = res.json<{ error: { code: string; details: Record<string, unknown>[] } }>();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toHaveLength(1);
    expect(Object.keys(error.details[0] ?? {}).sort()).toEqual(['instancePath', 'keyword', 'message']);
    expect(error.details[0]).toMatchObject({ instancePath: '/level', keyword: 'invalid_value' });
    expect(typeof error.details[0]?.message).toBe('string');
  });

  it('invalid zod query -> details instancePath /limit', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    typed().get('/q', { schema: { querystring: z.object({ limit: z.coerce.number() }) } }, () => ({}));
    const res = await app.inject({ method: 'GET', url: '/q?limit=abc', headers: AUTH });
    expect(res.statusCode).toBe(400);
    const { error } = res.json<{ error: { code: string; details: { instancePath: string }[] } }>();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details[0]?.instancePath).toBe('/limit');
  });

  it('multiple issues -> one details item per issue', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    typed().post('/v', { schema: { body: z.object({ a: z.string(), b: z.string() }) } }, () => ({}));
    const res = await app.inject({ method: 'POST', url: '/v', headers: AUTH, payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { details: unknown[] } }>().error.details).toHaveLength(2);
  });

  it('response schema mismatch -> generic 500, no leak, error logged', async () => {
    const lines: string[] = [];
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'info', logStream: { write: (m) => lines.push(m) } });
    typed().get(
      '/r',
      { schema: { response: { 200: z.object({ id: z.string() }) } } },
      // Deliberately violates the response schema.
      () => ({ id: 1 }) as unknown as { id: string },
    );
    const res = await app.inject({ method: 'GET', url: '/r', headers: AUTH });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toMatch(/"id"|expected|string/);
    expect('details' in res.json<{ error: object }>().error).toBe(false);
    expect(lines.map((l) => JSON.parse(l) as { level: number }).some((l) => l.level === 50)).toBe(true);
  });

  it('malformed JSON body responds 400 VALIDATION_ERROR', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.post('/j', () => ({}));
    const res = await app.inject({
      method: 'POST',
      url: '/j',
      headers: { ...AUTH, 'content-type': 'application/json' },
      payload: '{bad',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('empty body with JSON content-type responds 400 VALIDATION_ERROR', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.post('/j', () => ({}));
    const res = await app.inject({
      method: 'POST',
      url: '/j',
      headers: { ...AUTH, 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('unsupported media type responds 415 with the VALIDATION_ERROR envelope', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.post('/j', () => ({}));
    const res = await app.inject({
      method: 'POST',
      url: '/j',
      headers: { ...AUTH, 'content-type': 'text/xml' },
      payload: '<a/>',
    });
    expect(res.statusCode).toBe(415);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('body over bodyLimit -> 413 PAYLOAD_TOO_LARGE', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.post('/j', () => ({}));
    const res = await app.inject({
      method: 'POST',
      url: '/j',
      headers: { ...AUTH, 'content-type': 'application/json' },
      payload: JSON.stringify({ a: 'x'.repeat(1_048_576 + 10) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('unexpected error -> generic 500 without leaks', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.get('/boom', () => {
      throw new Error('db password=secret at /srv/x');
    });
    const res = await app.inject({ method: 'GET', url: '/boom', headers: AUTH });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toMatch(/secret|\/srv\/x|Error:|\bat /);
  });

  it('original error is logged at error level with stack', async () => {
    const lines: string[] = [];
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'info', logStream: { write: (m) => lines.push(m) } });
    app.get('/boom', () => {
      throw new Error('db password=secret at /srv/x');
    });
    await app.inject({ method: 'GET', url: '/boom', headers: AUTH });
    const entry = lines
      .map((l) => JSON.parse(l) as { level: number; err?: { message: string; stack: string } })
      .find((l) => l.level === 50);
    expect(entry?.err?.message).toContain('password=secret');
    expect(entry?.err?.stack).toContain('at ');
  });

  it('AppError passes through with details', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.get('/conflict', () => {
      throw new AppError(409, 'ANALYSIS_IN_PROGRESS', 'busy', { id: 'x' });
    });
    const res = await app.inject({ method: 'GET', url: '/conflict', headers: AUTH });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'ANALYSIS_IN_PROGRESS', message: 'busy', details: { id: 'x' } },
    });
  });

  it('non-error statusCode (200 / non-numeric) -> generic 500', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.get('/a', () => {
      throw Object.assign(new Error('x'), { statusCode: 200 });
    });
    app.get('/b', () => {
      throw Object.assign(new Error('x'), { statusCode: 'nope' });
    });
    for (const url of ['/a', '/b']) {
      const res = await app.inject({ method: 'GET', url, headers: AUTH });
      expect(res.statusCode).toBe(500);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('errors from an encapsulated child plugin use the root handler', async () => {
    app = buildApp({ serviceRepository: repo, checkDatabase: dbOk, logLevel: 'silent' });
    app.register((child, _opts, done) => {
      child.get('/child', () => {
        throw new AppError(409, 'ANALYSIS_IN_PROGRESS', 'busy');
      });
      done();
    });
    const res = await app.inject({ method: 'GET', url: '/child', headers: AUTH });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('ANALYSIS_IN_PROGRESS');
  });
});

describe('toErrorResponse', () => {
  it.each([
    [413, 'PAYLOAD_TOO_LARGE'],
    [404, 'NOT_FOUND'],
    [401, 'UNAUTHORIZED'],
    [415, 'VALIDATION_ERROR'],
  ])('maps non-AppError %i to %s keeping the status', (statusCode, code) => {
    const res = toErrorResponse({ statusCode, message: 'm' });
    expect(res.statusCode).toBe(statusCode);
    expect(res.body.error.code).toBe(code);
    expect('details' in res.body.error).toBe(false);
  });

  it('statusCode 429 keeps status with VALIDATION_ERROR', () => {
    const res = toErrorResponse({ statusCode: 429, message: 'slow down' });
    expect(res.statusCode).toBe(429);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps non-object throwables to 500', () => {
    expect(toErrorResponse('x').statusCode).toBe(500);
  });
});
