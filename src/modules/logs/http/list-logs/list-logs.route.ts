import type { ZodApi } from '@/shared/http/zod-api.types.js';
import type { LogsRoutesDeps } from '@/modules/logs/http/create-logs-routes.types.js';
import { listLogsQuerySchema, listLogsResponseSchema } from '@/schemas/logs.schema.js';

export function registerListLogsRoute(api: ZodApi, deps: LogsRoutesDeps): void {
  api.get(
    '/logs',
    {
      schema: {
        summary: 'List logs of every service, newest first',
        tags: ['logs'],
        querystring: listLogsQuerySchema,
        response: { 200: listLogsResponseSchema },
      },
    },
    (request) => {
      // Listing is cross-service: the key only authenticates (done by the /api auth hook).
      const { limit, cursor, ...filters } = request.query;
      return deps.logs.list({ filters, limit, cursor });
    },
  );
}
