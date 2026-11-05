import type { z } from 'zod';

/** `superRefine` callback: `from` must not be after `to` (equal is allowed). */
export function checkDateRange(
  value: { from?: Date | undefined; to?: Date | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.from && value.to && value.from.getTime() > value.to.getTime()) {
    ctx.addIssue({ code: 'custom', path: ['from'], message: 'from must not be after to' });
  }
}
