import type { RequestHandler } from 'express';
import { healthRepository } from '@/repositories/health.repository.js';
import { healthResponseSchema } from '@/schemas/health.schema.js';
import { ServiceUnavailableError } from '@/shared/errors.js';
import { sendJson } from './request-io.js';

/** A hung database must not hang the health check (and the orchestrator probing it). */
export const HEALTH_DB_TIMEOUT_MS = 2000;

function withTimeout(check: () => Promise<void>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`database check timed out after ${ms} ms`)), ms);
  });
  return Promise.race([check(), timeout]).finally(() => clearTimeout(timer));
}

/** `GET /api/health`: 503 uses the standard error envelope with the database state in `details`. */
const health: RequestHandler = async (req, res) => {
  try {
    await withTimeout(() => healthRepository.ping(), HEALTH_DB_TIMEOUT_MS);
  } catch (err) {
    req.log.warn({ err }, 'health check: database unreachable');
    throw new ServiceUnavailableError('Database unreachable', { database: 'unreachable' });
  }
  sendJson(res, 200, healthResponseSchema, { status: 'ok', database: 'ok' });
};

export const healthController = { health };
