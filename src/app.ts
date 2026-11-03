import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { registerAuthHook } from './modules/services/http/auth-hook.js';
import type { ServiceRepository } from './modules/services/domain/service-repository.js';
import type { LogLevel } from './shared/config/env.js';
import { registerErrorHandling } from './shared/http/error-handler.js';
import { healthRoute, type DatabaseCheck } from './shared/http/health-route.js';

const BODY_LIMIT_BYTES = 1_048_576; // 1 MiB, the 413 limit of ARCHITECTURE.md 6.1

export interface BuildAppOptions {
  /** Required: auth is always on (fail-closed by type). */
  serviceRepository: ServiceRepository;
  /** Required: `GET /api/health` must probe the real database, never report ok blindly. */
  checkDatabase: DatabaseCheck;
  /** Route plugins mounted inside the authenticated `/api` scope. */
  apiRoutes?: readonly FastifyPluginAsyncZod[];
  logLevel?: LogLevel;
  /** Test seam: receives raw pino JSON lines (to assert on logs). */
  logStream?: { write(msg: string): void };
}

/** Builds the Fastify instance without listening (usable with `inject`). */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    requestIdHeader: 'x-request-id',
    logger: {
      level: options.logLevel ?? 'info',
      redact: ['req.headers["x-api-key"]'],
      ...(options.logStream && { stream: options.logStream }),
    },
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);
  void app.register(swagger, {
    openapi: {
      info: { title: 'SmartLog Analyzer API', version: '0.0.0' },
      components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } } },
      security: [{ apiKey: [] }],
    },
    transform: jsonSchemaTransform,
  });
  // Root-level, outside the /api scope: public by construction (no hook applies).
  void app.register(swaggerUi, { routePrefix: '/docs' });

  const { serviceRepository, checkDatabase, apiRoutes = [] } = options;
  // Sibling of the /api scope below, so the auth hook never applies to it.
  void app.register(healthRoute, { prefix: '/api', checkDatabase });
  // Plain plugin (no fastify-plugin): the hook stays inside the scope, so 404s and out-of-scope routes skip auth.
  void app.register(
    async (api) => {
      registerAuthHook(api, serviceRepository);
      for (const routes of apiRoutes) await api.register(routes);
    },
    { prefix: '/api' },
  );
  return app;
}
