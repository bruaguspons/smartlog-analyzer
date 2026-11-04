import { z } from 'zod';
import { ANALYSIS_ERROR_CODES, ANALYSIS_STATUSES, FINDING_CATEGORIES, FINDING_SEVERITIES } from '../domain/analysis.js';

/** `GET /api/analysis/{id}`. The raw LLM response has no field here, so it can never be serialized. */
export const analysisResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(ANALYSIS_STATUSES),
  createdAt: z.date(),
  durationMs: z.number().int().nullable(),
  logCount: z.number().int(),
  provider: z.string(),
  model: z.string(),
  summary: z.string().nullable(),
  findings: z.array(
    z.object({
      id: z.number().int(),
      category: z.enum(FINDING_CATEGORIES),
      severity: z.enum(FINDING_SEVERITIES),
      description: z.string(),
      suggestions: z.array(z.string()),
      logIds: z.array(z.uuid()),
    }),
  ),
  tokens: z.object({ prompt: z.number().int(), completion: z.number().int() }).nullable(),
  error: z.object({ code: z.enum(ANALYSIS_ERROR_CODES), message: z.string() }).nullable(),
});
