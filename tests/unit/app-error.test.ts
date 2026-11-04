import { describe, expect, it } from 'vitest';
import { AppError, ConflictError, UnprocessableError } from '../../src/shared/errors/app-error.js';
import { toErrorResponse } from '../../src/shared/http/error-handler.js';

describe('ConflictError', () => {
  it('is a 409 AppError carrying code, message and details', () => {
    const err = new ConflictError('ANALYSIS_IN_PROGRESS', 'busy', { id: 'x' });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('ANALYSIS_IN_PROGRESS');
    expect(err.details).toEqual({ id: 'x' });
  });

  it('renders the error envelope with details', () => {
    expect(toErrorResponse(new ConflictError('ANALYSIS_IN_PROGRESS', 'busy', { id: 'x' }))).toEqual({
      statusCode: 409,
      body: { error: { code: 'ANALYSIS_IN_PROGRESS', message: 'busy', details: { id: 'x' } } },
    });
  });
});

describe('UnprocessableError', () => {
  it('is a 422 AppError rendered without details', () => {
    const err = new UnprocessableError('NO_LOGS_TO_ANALYZE', 'nothing to analyze');
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(422);
    expect(toErrorResponse(err)).toEqual({
      statusCode: 422,
      body: { error: { code: 'NO_LOGS_TO_ANALYZE', message: 'nothing to analyze' } },
    });
  });
});
