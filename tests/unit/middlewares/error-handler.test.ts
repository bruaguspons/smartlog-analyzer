import type { Request, RequestHandler, Response, Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { sendJson } from '@/controllers/request-io.js';
import { errorHandler, toErrorResponse } from '@/middlewares/error-handler.js';
import { parseJsonBody } from '@/middlewares/parse-json-body.js';
import { AppError, ResponseValidationError } from '@/shared/errors.js';
import { buildTestApp } from '@tests/support/apps/express-test-app.js';

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

  it('maps the body-parser errors by type', () => {
    expect(toErrorResponse({ type: 'entity.too.large', statusCode: 413, message: 'request entity too large' })).toMatchObject({
      statusCode: 413,
      body: { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } },
    });
    expect(toErrorResponse({ type: 'entity.parse.failed', statusCode: 400, message: 'Unexpected token' })).toMatchObject({
      statusCode: 400,
      body: { error: { code: 'VALIDATION_ERROR', message: "Body is not valid JSON but content-type is set to 'application/json'" } },
    });
  });

  it('a response that broke its schema is a generic 500 without issues', () => {
    const res = toErrorResponse(new ResponseValidationError([]));
    expect(res).toEqual({ statusCode: 500, body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } } });
  });

  it('maps non-object throwables and non-4xx status codes to 500', () => {
    expect(toErrorResponse('x').statusCode).toBe(500);
    expect(toErrorResponse({ statusCode: 200, message: 'x' }).statusCode).toBe(500);
    expect(toErrorResponse({ statusCode: 'nope', message: 'x' }).statusCode).toBe(500);
  });

  it('keeps an AppError as it is, with details', () => {
    expect(toErrorResponse(new AppError(409, 'ANALYSIS_IN_PROGRESS', 'busy', { id: 'x' }))).toEqual({
      statusCode: 409,
      body: { error: { code: 'ANALYSIS_IN_PROGRESS', message: 'busy', details: { id: 'x' } } },
    });
  });
});

describe('error middleware', () => {
  const build = (mount: (router: Router) => void, logStream?: { write(m: string): void }) =>
    buildTestApp({ mount, ...(logStream && { logStream }) });
  const get = (path: string, handler: RequestHandler) => (router: Router) => router.get(path, handler);

  const level = (lines: string[], wanted: number) =>
    lines.map((l) => JSON.parse(l) as { level: number; err?: { message: string; stack: string } }).find((l) => l.level === wanted);

  it('an unknown route is 404 NOT_FOUND with no details key', async () => {
    const res = await request(build(() => undefined)).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const { error } = res.body as { error: Record<string, unknown> };
    expect(error.code).toBe('NOT_FOUND');
    expect('details' in error).toBe(false);
  });

  it('a thrown AppError passes through with its details', async () => {
    const app = build(get('/conflict', () => { throw new AppError(409, 'ANALYSIS_IN_PROGRESS', 'busy', { id: 'x' }); }));
    const res = await request(app).get('/api/conflict');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'ANALYSIS_IN_PROGRESS', message: 'busy', details: { id: 'x' } } });
  });

  it('an async handler that rejects is handled too', async () => {
    const app = build(get('/later', () => Promise.reject(new AppError(409, 'X', 'busy'))));
    expect((await request(app).get('/api/later')).status).toBe(409);
  });

  it('an unexpected error is a generic 500 without leaks, and the original is logged with its stack', async () => {
    const lines: string[] = [];
    const app = build(get('/boom', () => { throw new Error('db password=secret at /srv/x'); }), { write: (m) => lines.push(m) });
    const res = await request(app).get('/api/boom');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } });
    expect(res.text).not.toMatch(/secret|\/srv\/x|Error:|\bat /);
    const entry = level(lines, 50);
    expect(entry?.err?.message).toContain('password=secret');
    expect(entry?.err?.stack).toContain('at ');
  });

  it('a response schema mismatch is a generic 500, no leak, error logged', async () => {
    const lines: string[] = [];
    const app = build(
      get('/r', (_req, res) => { sendJson(res, 200, z.object({ id: z.string() }), { id: 1 } as unknown as { id: string }); }),
      { write: (m) => lines.push(m) },
    );
    const res = await request(app).get('/api/r');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(level(lines, 50)).toBeDefined();
  });

  it('an error after the headers were sent is handed to Express instead of answered twice', () => {
    const error = new Error('too late');
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() };
    errorHandler(error, {} as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledWith(error);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejections that are not server faults are logged at info, not error', async () => {
    const lines: string[] = [];
    const app = build(() => undefined, { write: (m) => lines.push(m) });
    await request(app).get('/nope');
    expect(level(lines, 50)).toBeUndefined();
    expect(level(lines, 30)).toBeDefined();
  });

  it.each([
    ['malformed JSON', 'application/json', '{bad', 400],
    ['empty body', 'application/json', '', 400],
    ['unsupported media type', 'text/xml', '<a/>', 415],
  ])('a body problem on a route with a body: %s', async (_name, type, payload, status) => {
    const app = build((router) => router.post('/j', parseJsonBody(), (_req, res) => void res.json({})));
    const res = await request(app).post('/api/j').set('Content-Type', type).send(payload);
    expect(res.status).toBe(status);
    expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('a body problem on an unknown route is still reported, except the media type (404)', async () => {
    const app = build(() => undefined);
    expect((await request(app).post('/api/x').set('Content-Type', 'application/json').send('{bad')).status).toBe(400);
    expect((await request(app).post('/api/x').set('Content-Type', 'application/json').send('')).status).toBe(400);
    expect((await request(app).post('/api/x').set('Content-Type', 'text/xml').send('<a/>')).status).toBe(404);
    expect((await request(app).post('/api/x').set('Content-Type', 'application/json').send('{"a":1}')).status).toBe(404);
    const big = await request(app).post('/api/x').set('Content-Type', 'application/json').send(JSON.stringify({ a: 'x'.repeat(1_048_576) }));
    expect(big.status).toBe(413);
  });
});
