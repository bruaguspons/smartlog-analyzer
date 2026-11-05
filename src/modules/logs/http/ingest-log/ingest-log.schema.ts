import { z } from 'zod';
import { LOG_LEVELS, MAX_TRACE_ID_LENGTH } from '@/modules/logs/domain/log.const.js';
import { jsonValueSchema } from '@/modules/logs/http/log-response/json-value.schema.js';
import { NO_NUL_MESSAGE } from '@/modules/logs/http/validation/no-nul.const.js';
import { noNul } from '@/modules/logs/http/validation/no-nul.js';
import { MAX_FUTURE_SKEW_MS, MAX_MESSAGE_LENGTH, MAX_METADATA_BYTES } from './ingest-log.const.js';

/**
 * Body schema for `POST /api/logs`. Strict: unknown keys (serviceId, id, trace_id...) are rejected.
 * `now` is read on every parse, so the future-skew rule stays deterministic under an injected clock.
 */
export function createIngestLogBodySchema(now: () => Date) {
  return z.strictObject({
    level: z.enum(LOG_LEVELS),
    timestamp: z.iso
      .datetime({ offset: true })
      .transform((s) => new Date(s))
      .refine((d) => d.getTime() <= now().getTime() + MAX_FUTURE_SKEW_MS, {
        message: 'timestamp must not be more than 5 minutes in the future',
      }),
    message: z.string().min(1).max(MAX_MESSAGE_LENGTH).refine(noNul, NO_NUL_MESSAGE),
    traceId: z.string().min(1).max(MAX_TRACE_ID_LENGTH).refine(noNul, NO_NUL_MESSAGE).optional(),
    metadata: z
      .record(z.string(), jsonValueSchema)
      .refine(noNul, { message: `metadata ${NO_NUL_MESSAGE}` })
      .refine((v) => Buffer.byteLength(JSON.stringify(v), 'utf8') <= MAX_METADATA_BYTES, {
        message: `metadata must serialize to at most ${MAX_METADATA_BYTES} bytes`,
      })
      .optional(),
  });
}
