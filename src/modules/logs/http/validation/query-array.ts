import { z } from 'zod';

/**
 * Query strings deliver a repeated key as an array and a single one as a string:
 * wrap the single value so both forms validate as one-element-or-more arrays.
 */
export const queryArray = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || Array.isArray(v) ? v : [v]), z.array(item).min(1));
