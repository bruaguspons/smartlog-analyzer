import Fastify, { type FastifyInstance } from 'fastify';
import type { LogLevel } from './shared/config/env.js';
import { helloRoutes } from './shared/http/hello.route.js';

export interface BuildAppOptions {
  logLevel?: LogLevel;
}

/** Builds the Fastify instance without listening (usable with `inject`). */
export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: { level: options.logLevel ?? 'info' } });
  app.register(helloRoutes, { prefix: '/api' });
  return app;
}
