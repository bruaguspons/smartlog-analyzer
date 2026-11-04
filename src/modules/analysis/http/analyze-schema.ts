import { z } from 'zod';
import { checkDateRange, logFiltersShape } from '../../logs/http/log-filters-schema.js';
import { pageShape } from '../../logs/http/list-logs-schema.js';

/** `POST /api/logs/analyze` JSON body: the shared filters plus the page controls, strict like the ingest body. */
export const analyzeBodySchema = z.strictObject({ ...logFiltersShape, ...pageShape }).superRefine(checkDateRange);

export const analyzeResponseSchema = z.object({
  id: z.uuid(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});

export const analysisIdParamsSchema = z.object({ id: z.uuid() });
