import { z } from 'zod';
import type { JsonValue } from '@/modules/logs/domain/log.types.js';

/**
 * Any JSON value (same accepted domain as `z.json()`).
 * It carries an id on purpose: the OpenAPI conversion runs per route and drops recursive schemas
 * that are not registered, leaving a `$ref` that points to nothing. With an id, swagger publishes
 * it as a component. Register it only here: ids are process-wide and a duplicate throws.
 */
export const jsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema),
    ]),
  )
  .meta({ id: 'JsonValue' });
