import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ResponseValidationError } from '@/controllers/request-io.js';
import { AppError, NotFoundError } from '@/shared/errors.js';
import { parseJsonBody } from './parse-json-body.js';

const INTERNAL_MESSAGE = 'Internal server error';
/** Message the API has always returned for a body that is not valid JSON. */
const INVALID_JSON_MESSAGE = "Body is not valid JSON but content-type is set to 'application/json'";
const TOO_LARGE_MESSAGE = 'Request body is too large';

const CLIENT_CODES: Record<number, string> = {
  401: 'UNAUTHORIZED',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
};

export interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

export interface ErrorResponse {
  statusCode: number;
  body: ErrorEnvelope;
}

const internal = (): ErrorResponse => ({
  statusCode: 500,
  body: { error: { code: 'INTERNAL_ERROR', message: INTERNAL_MESSAGE } },
});

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
  // A response that broke its schema must never leak what the schema was hiding.
  if (error instanceof ResponseValidationError) return internal();

  // Errors raised by body-parser, identified by their `type`.
  const { type, statusCode, message } = error as { type?: unknown; statusCode?: unknown; message?: unknown };
  if (type === 'entity.parse.failed') {
    return { statusCode: 400, body: { error: { code: 'VALIDATION_ERROR', message: INVALID_JSON_MESSAGE } } };
  }
  if (type === 'entity.too.large') {
    return { statusCode: 413, body: { error: { code: 'PAYLOAD_TOO_LARGE', message: TOO_LARGE_MESSAGE } } };
  }

  if (typeof statusCode === 'number' && Number.isInteger(statusCode) && statusCode >= 400 && statusCode < 500) {
    return {
      statusCode,
      body: {
        error: {
          code: CLIENT_CODES[statusCode] ?? 'VALIDATION_ERROR',
          message: typeof message === 'string' ? message : 'Invalid request',
        },
      },
    };
  }
  return internal();
}

/** The single error middleware: logs the original error and answers with the envelope, never a stack trace. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const { statusCode, body } = toErrorResponse(err);
  if (err instanceof ResponseValidationError) {
    req.log.error({ err, issues: err.issues }, 'response serialization failed');
  } else if (statusCode >= 500) req.log.error({ err }, 'unhandled error');
  else req.log.info({ err }, 'request rejected');
  res.status(statusCode).json(body);
};

const parseBodyOfUnmatchedRoute = parseJsonBody({ rejectUnsupported: false });

/**
 * Last route. The body is parsed first (as before: a malformed or oversized body is 400/413 even on
 * a URL that does not exist) and only then does the request become a 404.
 */
export const notFoundHandler: RequestHandler = (req, res, next) => {
  parseBodyOfUnmatchedRoute(req, res, (err) => next(err ?? new NotFoundError('Route not found')));
};
