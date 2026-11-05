import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { jsonSchemaTransform, jsonSchemaTransformObject, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerAuthHook } from '@/modules/services/http/auth-hook/register-auth-hook.js';
import { registerErrorHandling } from '@/shared/http/error-handler/register-error-handling.js';
import { healthRoute } from '@/shared/http/health/health-route.js';
import type { BuildAppOptions } from './build-app-options.types.js';

const BODY_LIMIT_BYTES = 1_048_576; // 1 MiB; larger bodies get 413 PAYLOAD_TOO_LARGE

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
      components: {
        securitySchemes: {
          apiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
            // Shown in the Swagger UI "Authorize" dialog. Seed values, not secrets.
            description: 'Dev keys from the seed: dev-key-payments-0001 (payments-api), dev-key-orders-0002 (orders-api). dev-key-legacy-0003 is inactive and returns 401.',
          },
        },
      },
      security: [{ apiKey: [] }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
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
