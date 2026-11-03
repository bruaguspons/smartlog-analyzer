import Fastify, { type FastifyInstance } from 'fastify';
import { registerAuthHook } from './modules/services/http/auth-hook.js';
import type { ServiceRepository } from './modules/services/domain/service-repository.js';
import type { LogLevel } from './shared/config/env.js';
import { registerErrorHandling } from './shared/http/error-handler.js';

export interface BuildAppOptions {
  /** Required: auth is always on (fail-closed by type). */
  serviceRepository: ServiceRepository;
  logLevel?: LogLevel;
  /** Test seam: receives raw pino JSON lines (to assert on logs). */
  logStream?: { write(msg: string): void };
}

/** Builds the Fastify instance without listening (usable with `inject`). */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      ...(options.logStream && { stream: options.logStream }),
    },
  });
  registerErrorHandling(app);
  registerAuthHook(app, options.serviceRepository);
  return app;
}
