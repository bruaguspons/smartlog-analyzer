import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import type { LogLevel } from '@/shared/config/load-config.js';
import type { DatabaseCheck } from '@/shared/http/health/health.types.js';

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
