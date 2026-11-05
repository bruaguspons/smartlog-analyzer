import type { ZodApi } from '@/shared/http/zod-api.types.js';
import { UnauthorizedError } from '@/shared/errors/unauthorized-error.js';
import type { LogsRoutesDeps } from '@/modules/logs/http/create-logs-routes.types.js';
import { logResponseSchema } from '@/modules/logs/http/log-response/log-response.schema.js';
import { ingestLog } from '@/modules/logs/application/ingest-log/ingest-log.js';
import { createIngestLogBodySchema } from './ingest-log.schema.js';

export function registerIngestLogRoute(api: ZodApi, deps: LogsRoutesDeps): void {
  const bodySchema = createIngestLogBodySchema(deps.now);
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
}
