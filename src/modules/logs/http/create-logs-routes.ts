import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { registerGetLogStatsRoute } from '@/modules/logs/http/get-log-stats/get-log-stats.route.js';
import { registerIngestLogRoute } from '@/modules/logs/http/ingest-log/ingest-log.route.js';
import { registerListLogsRoute } from '@/modules/logs/http/list-logs/list-logs.route.js';
import type { LogsRoutesDeps } from './create-logs-routes.types.js';

/** Factory because `buildApp({ apiRoutes })` registers plugins without options. */
export function createLogsRoutes(deps: LogsRoutesDeps): FastifyPluginAsyncZod {
  return (api) => {
    registerIngestLogRoute(api, deps);
    registerListLogsRoute(api, deps);
    registerGetLogStatsRoute(api, deps);
    return Promise.resolve();
  };
}
