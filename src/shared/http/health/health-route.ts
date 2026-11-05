import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ServiceUnavailableError } from '@/shared/errors/service-unavailable-error.js';
import { HEALTH_DB_TIMEOUT_MS } from './health.const.js';
import type { DatabaseCheck, HealthRouteOptions } from './health.types.js';

function withTimeout(check: DatabaseCheck, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database check timed out after ${ms} ms`)), ms);
  });
  return Promise.race([check(), timeout]).finally(() => clearTimeout(timer));
}

/**
 * `GET /health`, registered with the `/api` prefix outside the authenticated scope (public).
 * 503 uses the standard error envelope with the database state in `details`.
 */
export const healthRoute: FastifyPluginAsyncZod<HealthRouteOptions> = (app, opts) => {
  const timeoutMs = opts.timeoutMs ?? HEALTH_DB_TIMEOUT_MS;
  app.get(
    '/health',
    {
      schema: {
        security: [],
        response: { 200: z.object({ status: z.literal('ok'), database: z.literal('ok') }) },
      },
    },
    async (request) => {
      try {
        await withTimeout(opts.checkDatabase, timeoutMs);
      } catch (err) {
        request.log.warn({ err }, 'health check: database unreachable');
        throw new ServiceUnavailableError('Database unreachable', { database: 'unreachable' });
      }
      return { status: 'ok' as const, database: 'ok' as const };
    },
  );
  return Promise.resolve();
};
