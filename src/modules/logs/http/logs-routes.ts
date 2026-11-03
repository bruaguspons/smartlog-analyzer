import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { UnauthorizedError } from '../../../shared/errors/app-error.js';
import { ingestLog } from '../application/ingest-log.js';
import type { LogRepository } from '../domain/log-repository.js';
import { createIngestLogBodySchema, logResponseSchema } from './ingest-log-schema.js';

export interface LogsRoutesDeps {
  repo: LogRepository;
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
    return Promise.resolve();
  };
}
