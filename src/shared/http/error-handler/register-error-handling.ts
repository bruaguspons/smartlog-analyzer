import type { FastifyInstance } from 'fastify';
import { isResponseSerializationError } from 'fastify-type-provider-zod';
import { NotFoundError } from '@/shared/errors/not-found-error.js';
import { toErrorResponse } from './to-error-response.js';

/** Registers the single error handler and the not-found handler on the root instance. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const { statusCode, body } = toErrorResponse(error);
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'response serialization failed');
    } else if (statusCode >= 500) request.log.error({ err: error }, 'unhandled error');
    else request.log.info({ err: error }, 'request rejected');
    return reply.status(statusCode).send(body);
  });
  app.setNotFoundHandler((_request, reply) => {
    const { statusCode, body } = toErrorResponse(new NotFoundError('Route not found'));
    return reply.status(statusCode).send(body);
  });
}
