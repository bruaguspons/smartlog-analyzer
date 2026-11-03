import type { FastifyInstance } from 'fastify';
import { AppError, NotFoundError } from '../errors/app-error.js';

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export interface ErrorResponse {
  statusCode: number;
  body: ErrorEnvelope;
}

interface ValidationIssue {
  instancePath?: string;
  keyword?: string;
  params?: { missingProperty?: string };
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

function issuePath(issue: ValidationIssue, context: unknown): string {
  const fromInstance = (issue.instancePath ?? '').replace(/^\//, '').replaceAll('/', '.');
  if (fromInstance) return fromInstance;
  if (issue.params?.missingProperty) return issue.params.missingProperty;
  return typeof context === 'string' ? context : '';
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

  const e = error as { validation?: unknown; validationContext?: unknown; statusCode?: unknown; message?: unknown };
  if (Array.isArray(e.validation)) {
    const details = (e.validation as ValidationIssue[]).map((issue) => ({
      path: issuePath(issue, e.validationContext),
      issue: issue.keyword ?? 'invalid',
    }));
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
    if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');
    else request.log.info({ err: error }, 'request rejected');
    return reply.status(statusCode).send(body);
  });
  app.setNotFoundHandler((_request, reply) => {
    const { statusCode, body } = toErrorResponse(new NotFoundError('Route not found'));
    return reply.status(statusCode).send(body);
  });
}
