import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ServiceUnavailableError } from '../errors/app-error.js';

/** Resolves when the database answers; rejects otherwise. */
export type DatabaseCheck = () => Promise<void>;

/** A hung database must not hang the health check (and the orchestrator probing it). */
export const HEALTH_DB_TIMEOUT_MS = 2000;

export interface HealthRouteOptions {
  checkDatabase: DatabaseCheck;
  timeoutMs?: number;
}

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
