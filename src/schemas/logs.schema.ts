import { z } from 'zod';
import { LOG_LEVELS, MAX_TRACE_ID_LENGTH, type JsonValue } from '@/models/log.js';
import { logFiltersShape, pageShape } from './log-filters.schema.js';
import { checkDateRange, NO_NUL_MESSAGE, noNul } from './zod-helpers.js';

export const MAX_FUTURE_SKEW_MS = 300_000; // 5 minutes, inclusive
export const MAX_MESSAGE_LENGTH = 8192;
export const MAX_METADATA_BYTES = 16_384;

/**
 * Any JSON value (same accepted domain as `z.json()`).
 * It carries an id on purpose: the OpenAPI conversion drops recursive schemas that are not
 * registered, leaving a `$ref` that points to nothing. With an id, the document publishes it
 * as a component. Register it only here: ids are process-wide and a duplicate throws.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema),
    ]),
  )
  .meta({ id: 'JsonValue' });

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
      .record(z.string(), jsonValueSchema)
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
  metadata: z.record(z.string(), jsonValueSchema).nullable(),
});

export const listLogsQuerySchema = z.strictObject({ ...logFiltersShape, ...pageShape }).superRefine(checkDateRange);

export const listLogsResponseSchema = z.object({
  items: z.array(logResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

/** Strict so `limit`, `cursor` and unknown keys are rejected: stats is not paginated. */
export const logStatsQuerySchema = z.strictObject(logFiltersShape).superRefine(checkDateRange);

export const logStatsResponseSchema = z.object({
  total: z.number().int().min(0),
  groups: z.array(
    z.object({
      service: z.object({ id: z.number().int(), name: z.string() }),
      level: z.enum(LOG_LEVELS),
      count: z.number().int().min(1),
    }),
  ),
});
