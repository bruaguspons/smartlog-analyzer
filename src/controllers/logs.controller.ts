import type { RequestHandler } from 'express';
import {
  ingestLogBodySchema,
  listLogsQuerySchema,
  logResponseSchema,
  listLogsResponseSchema,
  logStatsQuerySchema,
  logStatsResponseSchema,
} from '@/schemas/logs.schema.js';
import { logsService } from '@/services/logs.service.js';
import { parseRequest, sendJson } from './request-io.js';

const ingest: RequestHandler = async (req, res) => {
  const body = parseRequest('body', ingestLogBodySchema, req.body);
  // The service comes from the API key, never from the body.
  const log = await logsService.ingest({ serviceId: res.locals.service.id, ...body });
  sendJson(res, 201, logResponseSchema, log);
};

const list: RequestHandler = async (req, res) => {
  // Listing is cross-service: the key only authenticates.
  const { limit, cursor, ...filters } = parseRequest('querystring', listLogsQuerySchema, req.query);
  sendJson(res, 200, listLogsResponseSchema, await logsService.list({ filters, limit, cursor }));
};

const stats: RequestHandler = async (req, res) => {
  const filters = parseRequest('querystring', logStatsQuerySchema, req.query);
  sendJson(res, 200, logStatsResponseSchema, await logsService.stats(filters));
};

export const logsController = { ingest, list, stats };
