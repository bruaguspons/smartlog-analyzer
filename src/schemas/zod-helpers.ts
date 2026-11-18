import { z } from 'zod';

export const NO_NUL_MESSAGE = 'must not contain NUL (U+0000) characters';

/**
 * Postgres cannot store U+0000 in `text` (22021) or `jsonb` (22P05), so such input would surface as a 500.
 * It is rejected up front (400) rather than stripped, which would silently alter what the client sent.
 * Walks strings, array items, and object keys and values; the check is on code units, so the literal
 * text backslash + "u0000" is not a false positive.
 */
export function hasNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(hasNul);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(([key, item]) => hasNul(key) || hasNul(item));
  }
  return false;
}

export const noNul = (value: unknown): boolean => !hasNul(value);

/**
 * Query strings deliver a repeated key as an array and a single one as a string:
 * wrap the single value so both forms validate as one-element-or-more arrays.
 */
export const queryArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item).min(1));

/** `superRefine` callback: `from` must not be after `to` (equal is allowed). */
export function checkDateRange(
  value: { from?: Date | undefined; to?: Date | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.from && value.to && value.from.getTime() > value.to.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must not be after to' });
  }
}
