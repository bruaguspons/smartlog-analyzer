import type { Express } from 'express';
import pino from 'pino';
import { createApp } from '@/app/create-app.js';
import type { Service } from '@/models/service.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import type { RouteDefinition } from '@/routes/mount-routes.js';

export interface TestAppOptions {
  /** Defaults to an empty repository: no key is valid. */
  serviceRepo?: ServiceRepository;
  routes?: readonly RouteDefinition[];
  /** Receives the raw pino JSON lines, to assert on logs. Without it the logger is silent. */
  logStream?: { write(msg: string): void };
}

/** A repository that only knows the given services, for tests of the HTTP edges that do not need a database. */
export function stubServiceRepository(services: readonly Service[] = []): ServiceRepository {
  return {
    findByApiKey: (apiKey) => Promise.resolve(services.find((s) => s.apiKey === apiKey) ?? null),
    findNamesByIds: (ids) =>
      Promise.resolve(new Map(services.filter((s) => ids.includes(s.id)).map((s) => [s.id, s.name]))),
  };
}

/** The real Express app with ad-hoc routes: the 404 middleware is last, so routes must be given up front. */
export function buildTestApp({ serviceRepo = stubServiceRepository(), routes = [], logStream }: TestAppOptions = {}): Express {
  const logger = pino({ level: logStream ? 'trace' : 'silent', redact: ['req.headers["x-api-key"]'] }, logStream);
  return createApp({ logger, serviceRepo, routes });
}
