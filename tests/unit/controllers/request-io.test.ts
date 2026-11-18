import type { Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseRequest, sendJson } from '@/controllers/request-io.js';
import { RequestValidationError, ResponseValidationError } from '@/shared/errors.js';

describe('parseRequest', () => {
  const schema = z.strictObject({ level: z.enum(['INFO', 'ERROR']), limit: z.coerce.number().default(5) });

  it('returns the parsed output (coerced, defaulted)', () => {
    expect(parseRequest('querystring', schema, { level: 'INFO', limit: '7' })).toEqual({ level: 'INFO', limit: 7 });
  });

  it('does not touch the input', () => {
    const input = { level: 'INFO' };
    parseRequest('body', schema, input);
    expect(input).toEqual({ level: 'INFO' });
  });

  it('throws a 400 whose message is "<part><path> <issue>" per issue, joined by ", "', () => {
    const failure = catchError(() => parseRequest('body', schema, { level: 'X', extra: 1 }));
    expect(failure).toBeInstanceOf(RequestValidationError);
    expect(failure.statusCode).toBe(400);
    expect(failure.code).toBe('VALIDATION_ERROR');
    expect(failure.message).toMatch(/^body\/level Invalid option.*, body\/ Unrecognized key: "extra"$/);
  });

  it('details carry only instancePath, keyword and message, with "/" for the root', () => {
    const failure = catchError(() => parseRequest('querystring', schema, { level: 'INFO', foo: 1 }));
    expect(failure.details).toEqual([
      { instancePath: '/', keyword: 'unrecognized_keys', message: 'Unrecognized key: "foo"' },
    ]);
  });

  it('nested paths are joined with "/"', () => {
    const nested = z.object({ level: z.array(z.enum(['INFO'])) });
    const failure = catchError(() => parseRequest('body', nested, { level: ['X'] }));
    expect(failure.message).toContain('body/level/0 ');
  });

  it('treats a missing value as null', () => {
    const failure = catchError(() => parseRequest('body', schema, undefined));
    expect(failure.message).toBe('body/ Invalid input: expected object, received null');
  });

  function catchError(fn: () => unknown): RequestValidationError {
    try {
      fn();
    } catch (err) {
      return err as RequestValidationError;
    }
    throw new Error('expected parseRequest to throw');
  }
});

describe('sendJson', () => {
  function fakeResponse() {
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    return res;
  }

  it('answers with the parsed data, so unknown keys are stripped', () => {
    const res = fakeResponse();
    sendJson(res as unknown as Response, 201, z.object({ id: z.number() }), { id: 1, apiKey: 'secret' } as { id: number });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 1 });
  });

  it('throws ResponseValidationError (and sends nothing) when the data breaks the schema', () => {
    const res = fakeResponse();
    const send = () => sendJson(res as unknown as Response, 200, z.object({ id: z.string() }), { id: 1 } as unknown as { id: string });
    expect(send).toThrow(ResponseValidationError);
    expect(res.json).not.toHaveBeenCalled();
  });
});
