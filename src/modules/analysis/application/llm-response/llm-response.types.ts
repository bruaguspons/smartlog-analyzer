import type { z } from 'zod';
import type { llmResponseSchema } from './llm-response.schema.js';

export type LlmResponse = z.infer<typeof llmResponseSchema>;
