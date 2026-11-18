import type { ZodApi } from '@/shared/http/zod-api.types.js';
import { UnauthorizedError } from '@/shared/errors.js';
import type { LogsRoutesDeps } from '@/modules/logs/http/create-logs-routes.types.js';
import { createIngestLogBodySchema, logResponseSchema } from '@/schemas/logs.schema.js';

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
      const log = await deps.logs.ingest({ serviceId: service.id, ...request.body });
      return reply.status(201).send(log);
    },
  );
}
