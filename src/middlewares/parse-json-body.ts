import express, { type Request, type RequestHandler } from 'express';
import { AppError } from '@/shared/errors.js';

export const BODY_LIMIT_BYTES = 1_048_576; // 1 MiB; larger bodies get 413 PAYLOAD_TOO_LARGE

const EMPTY_BODY_MESSAGE = "Body cannot be empty when content-type is set to 'application/json'";

/** Keys that could pollute prototypes once the parsed body is merged or spread somewhere. */
function rejectPoisonedKeys(key: string, value: unknown): unknown {
  const hasPrototypeKey = typeof value === 'object' && value !== null && Object.hasOwn(value, 'prototype');
  if (key === '__proto__' || (key === 'constructor' && hasPrototypeKey)) throw new Error('poisoned key');
  return value;
}

function hasBody(req: Request): boolean {
  return req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length'] ?? 0) > 0;
}

export interface ParseJsonBodyOptions {
  /** Answer 415 to a body that is neither JSON nor plain text. Off for unmatched routes, which answer 404. */
  rejectUnsupported?: boolean;
}

/**
 * Per-route body parser that reproduces what the API always answered: JSON (any case or charset of
 * `application/json`, nothing else like `application/vnd.api+json`) and `text/plain` (kept as a string,
 * so validation rejects it) are read; any other body is 415; an empty JSON body is 400;
 * a missing body stays `undefined`. Size and syntax errors come from body-parser and are mapped by the error handler.
 */
export function parseJsonBody({ rejectUnsupported = true }: ParseJsonBodyOptions = {}): RequestHandler {
  const json = express.json({
    limit: BODY_LIMIT_BYTES,
    strict: false, // a bare `null` or string is valid JSON: the schema rejects it with a proper message
    type: () => true,
    reviver: rejectPoisonedKeys,
    verify: (_req, _res, buffer) => {
      if (buffer.length === 0) throw new AppError(400, 'VALIDATION_ERROR', EMPTY_BODY_MESSAGE);
    },
  });
  const text = express.text({ limit: BODY_LIMIT_BYTES, type: () => true });

  return (req, res, next) => {
    const contentType = req.headers['content-type'];
    const mediaType = contentType?.split(';')[0]?.trim().toLowerCase();
    if (mediaType === 'application/json') return json(req, res, next);
    if (mediaType === 'text/plain') return text(req, res, next);
    if (rejectUnsupported && (contentType !== undefined || hasBody(req))) {
      return next(new AppError(415, 'VALIDATION_ERROR', 'Unsupported Media Type'));
    }
    next();
  };
}
