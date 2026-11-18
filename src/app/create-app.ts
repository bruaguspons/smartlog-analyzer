import { randomUUID } from 'node:crypto';
import express, { Router, type Express, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { errorHandler, notFoundHandler } from '@/middlewares/error-handler.js';
import { parseJsonBody } from '@/middlewares/parse-json-body.js';
import { requireApiKey } from '@/middlewares/require-api-key.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import { mountRoutes, type RouteDefinition } from '@/routes/mount-routes.js';
import { API_PREFIX, buildOpenApiDocument } from './openapi.js';

export interface AppDeps {
  logger: Logger;
  serviceRepo: ServiceRepository;
  routes: readonly RouteDefinition[];
}

/** Uses the caller's `x-request-id` when there is one, so a request can be followed across systems. */
function requestId(req: express.Request): string {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' && header !== '' ? header : randomUUID();
}

/** Builds the Express app without listening (usable with supertest). */
export function createApp({ logger, serviceRepo, routes }: AppDeps): Express {
  const app = express();
  // Strictness the API always had: no X-Powered-By or ETag, `/api/logs/` and `/API/logs` are 404,
  // and `level=A&level=B` is the only way to repeat a key (`level[]=A` stays a literal, unknown key).
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('query parser', 'simple');
  app.set('strict routing', true);
  app.set('case sensitive routing', true);

  app.use(pinoHttp({ logger, genReqId: requestId }));

  // Public, mounted before /api. Only `/docs` and `/docs/json` exist: anything else under /docs is a 404.
  const document = buildOpenApiDocument(routes);
  app.get('/docs/json', (_req, res) => {
    res.json(document);
  });
  const ui = swaggerUi.setup(document);
  const onlyIndex: RequestHandler = (req, res, next) => (req.path === '/' ? ui(req, res, next) : next());
  app.use('/docs', swaggerUi.serveFiles(document), onlyIndex);

  const api = Router({ strict: true, caseSensitive: true });
  app.use(API_PREFIX, mountRoutes(api, routes, { auth: requireApiKey(serviceRepo), json: parseJsonBody() }));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
