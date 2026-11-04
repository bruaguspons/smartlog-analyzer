import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { UnauthorizedError } from '../../../shared/errors/app-error.js';
import type { ServiceRepository } from '../../services/domain/service-repository.js';
import { getLogStats } from '../application/get-log-stats.js';
import { listLogs } from '../application/list-logs.js';
import { ingestLog } from '../application/ingest-log.js';
import type { LogRepository } from '../domain/log-repository.js';
import { createIngestLogBodySchema, logResponseSchema } from './ingest-log-schema.js';
import { logStatsQuerySchema, logStatsResponseSchema } from './log-stats-schema.js';
import { listLogsQuerySchema, listLogsResponseSchema } from './list-logs-schema.js';

export interface LogsRoutesDeps {
  repo: LogRepository;
  serviceRepo: ServiceRepository;
  newId: () => string;
  now: () => Date;
}

/** Factory because `buildApp({ apiRoutes })` registers plugins without options. */
export function createLogsRoutes(deps: LogsRoutesDeps): FastifyPluginAsyncZod {
  const bodySchema = createIngestLogBodySchema(deps.now);
  return (api) => {
    api.post(
      '/logs',
      {
        schema: {
          summary: 'Ingest a log',
          tags: ['logs'],
          body: bodySchema,
          response: { 201: logResponseSchema },
        },
      },
      async (request, reply) => {
        // Fail closed: the auth hook always sets this, but never trust it with a non-null assertion.
        const service = request.service;
        if (!service) throw new UnauthorizedError();
        const log = await ingestLog({ serviceId: service.id, ...request.body }, deps);
        return reply.status(201).send(log);
      },
    );
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
        return listLogs({ filters, limit, cursor }, deps);
      },
    );
    // Registered next to `/logs`; any future `/logs/:id` must come after it.
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
    return Promise.resolve();
  };
}
