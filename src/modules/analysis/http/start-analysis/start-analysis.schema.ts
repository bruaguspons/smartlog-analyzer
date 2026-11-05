import { z } from 'zod';
import { checkDateRange } from '@/modules/logs/http/validation/check-date-range.js';
import { logFiltersShape } from '@/modules/logs/http/log-filters/log-filters.schema.js';
import { pageShape } from '@/modules/logs/http/pagination/page-shape.js';

/** `POST /api/logs/analyze` JSON body: the shared filters plus the page controls, strict like the ingest body. */
export const analyzeBodySchema = z.strictObject({ ...logFiltersShape, ...pageShape }).superRefine(checkDateRange);

export const analyzeResponseSchema = z.object({
  id: z.uuid(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
