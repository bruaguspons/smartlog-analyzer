import { z } from 'zod';
import { LOG_LEVELS } from '@/modules/logs/domain/log.const.js';
import { checkDateRange } from '@/modules/logs/http/validation/check-date-range.js';
import { logFiltersShape } from '@/modules/logs/http/log-filters/log-filters.schema.js';

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
