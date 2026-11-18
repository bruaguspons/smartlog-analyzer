import type { Response } from 'express';
import type { z } from 'zod';
import { AppError } from '@/shared/errors.js';

export type RequestPart = 'body' | 'querystring' | 'params';

/** 400 in the standard envelope; the message lists every issue, `details` has one item per issue. */
export class RequestValidationError extends AppError {
  constructor(part: RequestPart, issues: readonly z.core.$ZodIssue[]) {
    const details = issues.map((issue) => ({
      instancePath: `/${issue.path.join('/')}`,
      keyword: issue.code,
      message: issue.message,
    }));
    const message = details.map((d) => `${part}${d.instancePath} ${d.message}`).join(', ');
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

/** A handler produced data its own response schema rejects: a bug, answered as a generic 500. */
export class ResponseValidationError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    super('response does not match its schema');
    this.name = 'ResponseValidationError';
    this.issues = issues;
  }
}

/**
 * Validates one part of the request and returns the typed result. The input is never mutated
 * (`req.query` is a getter in Express 5, so it could not be replaced anyway).
 * An absent body reads as `null`, which is what the old framework reported for it.
 */
export function parseRequest<S extends z.ZodType>(part: RequestPart, schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value ?? null);
  if (!parsed.success) throw new RequestValidationError(part, parsed.error.issues);
  return parsed.data;
}

/**
 * Serializes through the response schema: keys the schema does not list (an API key, the raw
 * LLM response) can never leave, and a mismatch fails loudly instead of leaking a wrong shape.
 */
export function sendJson<S extends z.ZodType>(res: Response, status: number, schema: S, data: z.input<S>): void {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ResponseValidationError(parsed.error.issues);
  res.status(status).json(parsed.data);
}
