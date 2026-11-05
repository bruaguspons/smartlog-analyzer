import { describe, expect, it } from 'vitest';
import { toErrorResponse } from '@/shared/http/error-handler/to-error-response.js';

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
