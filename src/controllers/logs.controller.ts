import type { RequestHandler } from 'express';
import { createIngestLogBodySchema, listLogsQuerySchema, logResponseSchema, listLogsResponseSchema, logStatsQuerySchema, logStatsResponseSchema } from '@/schemas/logs.schema.js';
import type { LogsService } from '@/services/logs.service.js';
import { parseRequest, sendJson } from './request-io.js';

export interface LogsControllerDeps {
  logs: LogsService;
  now: () => Date;
}

/** The body schema is built once per controller: it reads the injected clock on every parse. */
export function createLogsController({ logs, now }: LogsControllerDeps) {
  const ingestBodySchema = createIngestLogBodySchema(now);

  const ingest: RequestHandler = async (req, res) => {
    const body = parseRequest('body', ingestBodySchema, req.body);
    // The service comes from the API key, never from the body.
    const log = await logs.ingest({ serviceId: res.locals.service.id, ...body });
    sendJson(res, 201, logResponseSchema, log);
  };

  const list: RequestHandler = async (req, res) => {
    // Listing is cross-service: the key only authenticates.
    const { limit, cursor, ...filters } = parseRequest('querystring', listLogsQuerySchema, req.query);
    sendJson(res, 200, listLogsResponseSchema, await logs.list({ filters, limit, cursor }));
  };

  const stats: RequestHandler = async (req, res) => {
    const filters = parseRequest('querystring', logStatsQuerySchema, req.query);
    sendJson(res, 200, logStatsResponseSchema, await logs.stats(filters));
  };

  return { ingest, list, stats, ingestBodySchema };
}
