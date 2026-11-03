import type { FastifyInstance } from 'fastify';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';
import { AppError, NotFoundError } from '../errors/app-error.js';

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export interface ErrorResponse {
  statusCode: number;
  body: ErrorEnvelope;
}

const INTERNAL_MESSAGE = 'Internal server error';

const CLIENT_CODES: Record<number, string> = {
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
};

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

/** Registers the single error handler and the not-found handler on the root instance. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = toErrorResponse(error);
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'response serialization failed');
    } else if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');
    else request.log.info({ err: error }, 'request rejected');
    return reply.status(statusCode).send(body);
  });
  app.setNotFoundHandler((_request, reply) => {
    const { statusCode, body } = toErrorResponse(new NotFoundError('Route not found'));
    return reply.status(statusCode).send(body);
  });
}
