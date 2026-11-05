import { z } from 'zod';

/**
 * Tolerant shape used to VALIDATE the model output: the structure is strict,
 * the content is not. Category and severity are free strings here and normalized later.
 */
export const llmResponseSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      category: z.string(),
      severity: z.string(),
      description: z.string(),
      suggestions: z.array(z.string()),
      logRefs: z.array(z.number()),
    }),
  ),
});
