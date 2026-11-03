import type { FastifyInstance } from 'fastify';
import { authenticate } from '../application/authenticate.js';
import type { Service } from '../domain/service.js';
import type { ServiceRepository } from '../domain/service-repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    service: Service | null;
  }
}

/** Registered on the encapsulated `/api` scope, so only its routes (and nested plugins) are protected. Never logs the key. */
export function registerAuthHook(app: FastifyInstance, repo: ServiceRepository): void {
  // Runtime guard for untyped callers: fail at boot, not on every request.
  if (typeof repo?.findByApiKey !== 'function') {
    throw new TypeError('registerAuthHook: a ServiceRepository is required');
  }
  app.decorateRequest('service', null);
  app.addHook('onRequest', async (request) => {
    request.service = await authenticate(request.headers['x-api-key'], repo);
  });
}
