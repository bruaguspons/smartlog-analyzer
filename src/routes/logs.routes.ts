import { Router } from 'express';
import { logsController } from '@/controllers/logs.controller.js';
import { parseJsonBody } from '@/middlewares/parse-json-body.js';
import { requireApiKey } from '@/middlewares/require-api-key.js';
import {
  ingestLogBodySchema,
  listLogsQuerySchema,
  listLogsResponseSchema,
  logResponseSchema,
  logStatsQuerySchema,
  logStatsResponseSchema,
} from '@/schemas/logs.schema.js';
import { documentRoute } from './openapi.js';

export const logsRouter = Router({ strict: true, caseSensitive: true });
const json = parseJsonBody();

// Auth goes first on every route: a bad key must win over a bad body, and an unknown `/api/x` stays a 404.
documentRoute({
  method: 'post',
  path: '/logs',
  summary: 'Ingest a log',
  tags: ['logs'],
  body: ingestLogBodySchema,
  responses: { 201: logResponseSchema },
});
logsRouter.post('/logs', requireApiKey, json, logsController.ingest);

documentRoute({
  method: 'get',
  path: '/logs',
  summary: 'List logs of every service, newest first',
  tags: ['logs'],
  query: listLogsQuerySchema,
  responses: { 200: listLogsResponseSchema },
});
logsRouter.get('/logs', requireApiKey, logsController.list);

documentRoute({
  method: 'get',
  path: '/logs/stats',
  summary: 'Count logs by service and level',
  tags: ['logs'],
  query: logStatsQuerySchema,
  responses: { 200: logStatsResponseSchema },
});
logsRouter.get('/logs/stats', requireApiKey, logsController.stats);
