import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';
import { AppError } from '../../src/shared/errors/app-error.js';
import { toErrorResponse } from '../../src/shared/http/error-handler.js';

const AUTH = { 'x-api-key': 'k-test' };
const repo = new InMemoryServiceRepository([
  { id: 1, name: 'svc', description: null, apiKey: 'k-test', isActive: true },
]);

describe('error envelope', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('S-EE-1: unknown route -> 404 NOT_FOUND, no details key', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
    const res = await app.inject({ method: 'GET', url: '/does-not-exist', headers: AUTH });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const body = res.json<{ error: Record<string, unknown> }>();
    expect(body.error.code).toBe('NOT_FOUND');
    expect(typeof body.error.message).toBe('string');
    expect('details' in body.error).toBe(false);
  });

  it('S-EE-2: schema validation -> 400 VALIDATION_ERROR with details', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
    app.get('/v', { schema: { querystring: { type: 'object', properties: { level: { enum: ['INFO', 'ERROR'] } } } } }, () => ({}));
    const res = await app.inject({ method: 'GET', url: '/v?level=NOPE', headers: AUTH });
    expect(res.statusCode).toBe(400);
    const { error } = res.json<{ error: { code: string; details: { path: string; issue: string }[] } }>();
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual([{ path: 'level', issue: 'enum' }]);
  });

  it('S-EE-3: malformed JSON body -> observed 400 VALIDATION_ERROR', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
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

  it('empty body with JSON content-type -> observed 400 VALIDATION_ERROR', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
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

  it('S-EE-4: unsupported media type -> observed 415 VALIDATION_ERROR envelope', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
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

  it('observed: body over bodyLimit -> 413 PAYLOAD_TOO_LARGE', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
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

  it('S-EE-5: unexpected error -> generic 500 without leaks', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
    app.get('/boom', () => {
      throw new Error('db password=secret at /srv/x');
    });
    const res = await app.inject({ method: 'GET', url: '/boom', headers: AUTH });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toMatch(/secret|\/srv\/x|Error:|\bat /);
  });

  it('S-EE-6: original error is logged at error level with stack', async () => {
    const lines: string[] = [];
    app = buildApp({ serviceRepository: repo, logLevel: 'info', logStream: { write: (m) => lines.push(m) } });
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

  it('S-EE-7: AppError passes through with details', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
    app.get('/conflict', () => {
      throw new AppError(409, 'ANALYSIS_IN_PROGRESS', 'busy', { id: 'x' });
    });
    const res = await app.inject({ method: 'GET', url: '/conflict', headers: AUTH });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: { code: 'ANALYSIS_IN_PROGRESS', message: 'busy', details: { id: 'x' } },
    });
  });

  it('S-EE-9: non-error statusCode (200 / non-numeric) -> generic 500', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
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

  it('S-EE-10: errors from an encapsulated child plugin use the root handler', async () => {
    app = buildApp({ serviceRepository: repo, logLevel: 'silent' });
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

  it('maps non-object throwables to 500', () => {
    expect(toErrorResponse('x').statusCode).toBe(500);
  });
});
