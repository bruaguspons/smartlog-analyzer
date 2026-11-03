import type { FastifyInstance } from 'fastify';
import { authenticate } from '../application/authenticate.js';
import type { Service } from '../domain/service.js';
import type { ServiceRepository } from '../domain/service-repository.js';

declare module 'fastify' {
  interface FastifyRequest {
    service: Service | null;
  }
  interface FastifyContextConfig {
    /** Opt out of X-API-Key authentication for this route. */
    public?: boolean;
  }
}

/** Registered on the root instance, so encapsulated route plugins inherit it. Never logs the key. */
export function registerAuthHook(app: FastifyInstance, repo: ServiceRepository): void {
  // Runtime guard for untyped callers: fail at boot, not on every request.
  if (typeof repo?.findByApiKey !== 'function') {
    throw new TypeError('registerAuthHook: a ServiceRepository is required');
  }
  app.decorateRequest('service', null);
  app.addHook('onRequest', async (request) => {
    if (request.is404 || request.routeOptions.config.public) return;
    request.service = await authenticate(request.headers['x-api-key'], repo);
  });
}
