import type { RequestHandler } from 'express';
import { healthResponseSchema } from '@/schemas/health.schema.js';
import { ServiceUnavailableError } from '@/shared/errors.js';
import { sendJson } from './request-io.js';

/** Resolves when the database answers; rejects otherwise. */
export type DatabaseCheck = () => Promise<void>;

/** A hung database must not hang the health check (and the orchestrator probing it). */
export const HEALTH_DB_TIMEOUT_MS = 2000;

export interface HealthControllerDeps {
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

/** `GET /api/health`: 503 uses the standard error envelope with the database state in `details`. */
export function createHealthController({ checkDatabase, timeoutMs = HEALTH_DB_TIMEOUT_MS }: HealthControllerDeps) {
  const health: RequestHandler = async (req, res) => {
    try {
      await withTimeout(checkDatabase, timeoutMs);
    } catch (err) {
      req.log.warn({ err }, 'health check: database unreachable');
      throw new ServiceUnavailableError('Database unreachable', { database: 'unreachable' });
    }
    sendJson(res, 200, healthResponseSchema, { status: 'ok', database: 'ok' });
  };
  return { health };
}
