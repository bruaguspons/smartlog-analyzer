import type { Response } from 'express';
import type { z } from 'zod';
import { RequestValidationError, ResponseValidationError, type RequestPart } from '@/shared/errors.js';

/**
 * Validates one part of the request and returns the typed result. The input is never mutated
 * (`req.query` is a getter in Express 5, so it could not be replaced anyway).
 * An absent body reads as `null`, which is what the API has always reported for it.
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
