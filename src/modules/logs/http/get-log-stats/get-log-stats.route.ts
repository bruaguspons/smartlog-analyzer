import type { ZodApi } from '@/shared/http/zod-api.types.js';
import type { LogsRoutesDeps } from '@/modules/logs/http/create-logs-routes.types.js';
import { getLogStats } from '@/modules/logs/application/get-log-stats/get-log-stats.js';
import { logStatsQuerySchema, logStatsResponseSchema } from './get-log-stats.schema.js';

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
    (request) => getLogStats(request.query, deps),
  );
}
