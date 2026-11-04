import { z } from 'zod';
import { decodeCursor } from '../application/log-cursor.js';
import { logResponseSchema } from './ingest-log-schema.js';
import { checkDateRange, logFiltersShape } from './log-filters-schema.js';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const listLogsQuerySchema = z
  .strictObject({
    ...logFiltersShape,
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
  })
  .superRefine(checkDateRange);

export const listLogsResponseSchema = z.object({
  items: z.array(logResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
