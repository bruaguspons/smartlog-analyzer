import { z } from 'zod';
import { LOG_LEVELS } from '../domain/log.js';
import { NO_NUL_MESSAGE, noNul } from './no-nul.js';

export const MAX_FUTURE_SKEW_MS = 300_000; // 5 minutes, inclusive
export const MAX_MESSAGE_LENGTH = 8192;
export const MAX_TRACE_ID_LENGTH = 128;
export const MAX_METADATA_BYTES = 16_384;

/**
 * Body schema for `POST /api/logs`. Strict: unknown keys (serviceId, id, trace_id...) are rejected.
 * `now` is read on every parse, so the future-skew rule stays deterministic under an injected clock.
 */
export function createIngestLogBodySchema(now: () => Date) {
  return z.strictObject({
    level: z.enum(LOG_LEVELS),
    timestamp: z.iso
      .datetime({ offset: true })
      .transform((s) => new Date(s))
      .refine((d) => d.getTime() <= now().getTime() + MAX_FUTURE_SKEW_MS, {
        message: 'timestamp must not be more than 5 minutes in the future',
      }),
    message: z.string().min(1).max(MAX_MESSAGE_LENGTH).refine(noNul, NO_NUL_MESSAGE),
    traceId: z.string().min(1).max(MAX_TRACE_ID_LENGTH).refine(noNul, NO_NUL_MESSAGE).optional(),
    metadata: z
      .record(z.string(), z.json())
      .refine(noNul, { message: `metadata ${NO_NUL_MESSAGE}` })
      .refine((v) => Buffer.byteLength(JSON.stringify(v), 'utf8') <= MAX_METADATA_BYTES, {
        message: `metadata must serialize to at most ${MAX_METADATA_BYTES} bytes`,
      })
      .optional(),
  });
}

export const logResponseSchema = z.object({
  id: z.uuid(),
  serviceId: z.number().int(),
  level: z.enum(LOG_LEVELS),
  timestamp: z.date(),
  message: z.string(),
  traceId: z.string().nullable(),
  metadata: z.record(z.string(), z.json()).nullable(),
});
