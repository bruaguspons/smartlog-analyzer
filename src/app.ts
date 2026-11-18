import { randomUUID } from 'node:crypto';
import express, { type Request, type RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { errorHandler, notFoundHandler } from '@/middlewares/error-handler.js';
// Each router registers its OpenAPI paths when it is imported, so this order is the order of the document.
import { healthRouter } from '@/routes/health.routes.js';
import { logsRouter } from '@/routes/logs.routes.js';
import { analysisRouter } from '@/routes/analysis.routes.js';
import { API_PREFIX, buildOpenApiDocument } from '@/routes/openapi.js';
import { logger } from '@/shared/logger.js';

/** Uses the caller's `x-request-id` when there is one, so a request can be followed across systems. */
function requestId(req: Request): string {
  const header = req.headers['x-request-id'];
  return typeof header === 'string' && header !== '' ? header : randomUUID();
}

export const app = express();

// Strictness the API always had: no X-Powered-By or ETag, `/api/logs/` and `/API/logs` are 404,
// and `level=A&level=B` is the only way to repeat a key (`level[]=A` stays a literal, unknown key).
app.disable('x-powered-by');
app.set('etag', false);
app.set('query parser', 'simple');
app.set('strict routing', true);
app.set('case sensitive routing', true);

app.use(pinoHttp({ logger, genReqId: requestId }));

// Public, mounted before /api. Only `/docs` and `/docs/json` exist: anything else under /docs is a 404.
// The routers imported above have registered their paths, so the document is complete here.
const document = buildOpenApiDocument();
app.get('/docs/json', (_req, res) => {
  res.json(document);
});
const ui = swaggerUi.setup(document);
const onlyIndex: RequestHandler = (req, res, next) => (req.path === '/' ? ui(req, res, next) : next());
app.use('/docs', swaggerUi.serveFiles(document), onlyIndex);

app.use(API_PREFIX, healthRouter);
app.use(API_PREFIX, logsRouter);
app.use(API_PREFIX, analysisRouter);

app.use(notFoundHandler);
app.use(errorHandler);
