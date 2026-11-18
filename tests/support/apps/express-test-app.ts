import type { Express } from 'express';
import pino from 'pino';
import { createApp } from '@/app/create-app.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import type { RouteDefinition } from '@/routes/mount-routes.js';

export interface TestAppOptions {
  serviceRepo: ServiceRepository;
  routes?: readonly RouteDefinition[];
  /** Receives the raw pino JSON lines, to assert on logs. Without it the logger is silent. */
  logStream?: { write(msg: string): void };
}

/** The real Express app with ad-hoc routes: the 404 middleware is last, so routes must be given up front. */
export function buildTestApp({ serviceRepo, routes = [], logStream }: TestAppOptions): Express {
  const logger = pino({ level: logStream ? 'trace' : 'silent', redact: ['req.headers["x-api-key"]'] }, logStream);
  return createApp({ logger, serviceRepo, routes });
}
