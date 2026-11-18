import { z } from 'zod';
import { LOG_LEVELS, MAX_TRACE_ID_LENGTH } from '@/models/log.js';
import { decodeCursor } from '@/shared/cursor.js';
import { NO_NUL_MESSAGE, noNul, queryArray } from './zod-helpers.js';

export const MAX_SEARCH_LENGTH = 256;
/** `services.id` is a Postgres Int4: larger values would overflow in the query and surface as a 500. */
export const MAX_SERVICE_ID = 2_147_483_647;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

/**
 * Swagger UI has no date picker: `format: date-time` renders as a text input, pre-filled with
 * these examples. Together they cover every sample log of the dev seed (a unit test checks it),
 * so "Try it out" returns data without editing the dates.
 */
export const FROM_EXAMPLE = '2026-11-01T00:00:00Z';
export const TO_EXAMPLE = '2026-11-01T23:59:59Z';

const isoDate = (example: string) =>
  z.iso
    .datetime({ offset: true })
    .meta({ description: `ISO 8601 with offset, e.g. ${example}`, example })
    .transform((s) => new Date(s));

/**
 * Shared by `GET /api/logs`, stats and analyze. Exported as a plain shape (not an object)
 * because zod 4 forbids `.extend()` on refined objects: callers compose their own strictObject.
 */
export const logFiltersShape = {
  serviceId: z.coerce.number().int().positive().max(MAX_SERVICE_ID).optional(),
  level: queryArray(z.enum(LOG_LEVELS)).optional(),
  from: isoDate(FROM_EXAMPLE).optional(),
  to: isoDate(TO_EXAMPLE).optional(),
  traceId: z.string().min(1).max(MAX_TRACE_ID_LENGTH).refine(noNul, NO_NUL_MESSAGE).optional(),
  search: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).refine(noNul, NO_NUL_MESSAGE).optional(),
};

/** Page controls shared by listing and analyze: defined once so both validate identically. */
export const pageShape = {
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  cursor: z
    .string()
    .transform((raw, ctx) => {
      const cursor = decodeCursor(raw);
      if (!cursor) {
        ctx.addIssue({ code: 'custom', message: 'invalid cursor' });
        return z.NEVER;
      }
      return cursor;
    })
    .optional(),
};
