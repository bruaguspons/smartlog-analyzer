import { z } from 'zod';
import { LOG_LEVELS } from '../domain/log.js';
import { MAX_TRACE_ID_LENGTH } from './ingest-log-schema.js';
import { NO_NUL_MESSAGE, noNul } from './no-nul.js';

export const MAX_SEARCH_LENGTH = 256;
/** `services.id` is a Postgres Int4: larger values would overflow in the query and surface as a 500. */
export const MAX_SERVICE_ID = 2_147_483_647;

/**
 * Query strings deliver a repeated key as an array and a single one as a string:
 * wrap the single value so both forms validate as one-element-or-more arrays.
 */
export const queryArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item).min(1));

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

/**
 * Shared by `GET /api/logs`, stats and analyze. Exported as a plain shape (not an object)
 * because zod 4 forbids `.extend()` on refined objects: callers compose their own strictObject.
 */
export const logFiltersShape = {
  serviceId: z.coerce.number().int().positive().max(MAX_SERVICE_ID).optional(),
  level: queryArray(z.enum(LOG_LEVELS)).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  traceId: z.string().min(1).max(MAX_TRACE_ID_LENGTH).refine(noNul, NO_NUL_MESSAGE).optional(),
  search: z.string().trim().min(1).max(MAX_SEARCH_LENGTH).refine(noNul, NO_NUL_MESSAGE).optional(),
};

/** `superRefine` callback: `from` must not be after `to` (equal is allowed). */
export function checkDateRange(
  value: { from?: Date | undefined; to?: Date | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.from && value.to && value.from.getTime() > value.to.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must not be after to' });
  }
}
