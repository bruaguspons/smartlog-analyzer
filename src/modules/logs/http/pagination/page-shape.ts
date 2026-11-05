import { z } from 'zod';
import { decodeCursor } from '@/modules/logs/application/cursor/decode-cursor.js';
import { DEFAULT_LIMIT, MAX_LIMIT } from './pagination.const.js';

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
