import type { ZodApi } from '@/shared/http/zod-api.types.js';
import type { LogsRoutesDeps } from '@/modules/logs/http/create-logs-routes.types.js';
import { logStatsQuerySchema, logStatsResponseSchema } from '@/schemas/logs.schema.js';

export function registerGetLogStatsRoute(api: ZodApi, deps: LogsRoutesDeps): void {
  // Static path: find-my-way matches it before any parametric /logs/:id, whatever the registration order.
  api.get(
    '/logs/stats',
    {
      schema: {
        summary: 'Count logs by service and level',
        tags: ['logs'],
        querystring: logStatsQuerySchema,
        response: { 200: logStatsResponseSchema },
      },
    },
    (request) => deps.logs.stats(request.query),
  );
}
