import { z } from 'zod';
import { checkDateRange } from '@/modules/logs/http/validation/check-date-range.js';
import { logFiltersShape } from '@/modules/logs/http/log-filters/log-filters.schema.js';
import { logResponseSchema } from '@/modules/logs/http/log-response/log-response.schema.js';
import { pageShape } from '@/modules/logs/http/pagination/page-shape.js';

export const listLogsQuerySchema = z.strictObject({ ...logFiltersShape, ...pageShape }).superRefine(checkDateRange);

export const listLogsResponseSchema = z.object({
  items: z.array(logResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
