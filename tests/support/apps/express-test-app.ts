import express, { type Express, type Router } from 'express';
import pino from 'pino';
import { pinoHttp } from 'pino-http';
import { errorHandler, notFoundHandler } from '@/middlewares/error-handler.js';

export interface TestAppOptions {
  /** Registers throwaway routes; they are served under `/api`, like the real ones. */
  mount?: (router: Router) => void;
  /** Receives the raw pino JSON lines, to assert on logs. Without it the logger is silent. */
  logStream?: { write(msg: string): void };
}

/**
 * A small Express app with the real error and 404 middlewares around throwaway routes. It needs no
 * database or configuration, so the HTTP edge cases (body parsing, error envelope) stay unit tests.
 */
export function buildTestApp({ mount, logStream }: TestAppOptions = {}): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);
  app.set('query parser', 'simple');
  app.set('strict routing', true);
  app.set('case sensitive routing', true);

  const logger = pino({ level: logStream ? 'trace' : 'silent', redact: ['req.headers["x-api-key"]'] }, logStream);
  app.use(pinoHttp({ logger }));

  const api = express.Router({ strict: true, caseSensitive: true });
  mount?.(api);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
