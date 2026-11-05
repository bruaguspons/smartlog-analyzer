import { z } from 'zod';
import { LOG_LEVELS } from '@/modules/logs/domain/log.const.js';
import { jsonValueSchema } from './json-value.schema.js';

export const logResponseSchema = z.object({
  id: z.uuid(),
  serviceId: z.number().int(),
  level: z.enum(LOG_LEVELS),
  timestamp: z.date(),
  message: z.string(),
  traceId: z.string().nullable(),
  metadata: z.record(z.string(), jsonValueSchema).nullable(),
});
