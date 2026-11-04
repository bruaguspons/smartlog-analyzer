import { z } from 'zod';
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from '../domain/analysis.js';

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
export type LlmResponse = z.infer<typeof llmResponseSchema>;

/** Enum-typed shape sent to the model as JSON schema so it is steered towards the closed sets. */
export const requestedResponseSchema = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      category: z.enum(FINDING_CATEGORIES),
      severity: z.enum(FINDING_SEVERITIES),
      description: z.string(),
      suggestions: z.array(z.string()),
      logRefs: z.array(z.number().int()),
    }),
  ),
});
