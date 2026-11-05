import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError } from '@/shared/errors/app-error.js';
import { CLIENT_CODES, INTERNAL_MESSAGE } from './error-handler.const.js';
import type { ErrorResponse } from './error-handler.types.js';

function internal(): ErrorResponse {
  return {
    statusCode: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } },
  };
}

/** Pure mapping from any thrown value to the HTTP status and error envelope. */
export function toErrorResponse(error: unknown): ErrorResponse {
  if (error instanceof AppError) {
    const { code, message, details } = error;
    return {
      statusCode: error.statusCode,
      body: { error: { code, message, ...(details !== undefined && { details }) } },
    };
  }
  if (typeof error !== 'object' || error === null) return internal();

  // Response serialization failures must never leak schema details (e.g. internal fields).
  if (isResponseSerializationError(error)) return internal();

  const e = error as { statusCode?: unknown; message?: unknown };
  if (hasZodFastifySchemaValidationErrors(error)) {
    const details = error.validation.map(({ instancePath, keyword, message }) => ({ instancePath, keyword, message }));
    const message = typeof e.message === 'string' ? e.message : 'Invalid request';
    return { statusCode: 400, body: { error: { code: 'VALIDATION_ERROR', message, details } } };
  }

  const status = e.statusCode;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500) {
    const message = typeof e.message === 'string' ? e.message : 'Invalid request';
    return {
      statusCode: status,
      body: { error: { code: CLIENT_CODES[status] ?? 'VALIDATION_ERROR', message } },
    };
  }
  return internal();
}
