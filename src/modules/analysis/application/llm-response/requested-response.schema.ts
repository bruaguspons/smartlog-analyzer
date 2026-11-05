import { z } from 'zod';
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from '@/modules/analysis/domain/analysis.const.js';

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
