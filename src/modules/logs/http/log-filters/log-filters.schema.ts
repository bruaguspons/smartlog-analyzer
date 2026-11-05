import { z } from 'zod';
import { LOG_LEVELS, MAX_TRACE_ID_LENGTH } from '@/modules/logs/domain/log.const.js';
import { FROM_EXAMPLE, MAX_SEARCH_LENGTH, MAX_SERVICE_ID, TO_EXAMPLE } from './log-filters.const.js';
import { NO_NUL_MESSAGE } from '@/modules/logs/http/validation/no-nul.const.js';
import { noNul } from '@/modules/logs/http/validation/no-nul.js';
import { queryArray } from '@/modules/logs/http/validation/query-array.js';

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
