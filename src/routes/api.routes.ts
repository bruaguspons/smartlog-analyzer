import { createAnalysisController } from '@/controllers/analysis.controller.js';
import { createHealthController, type DatabaseCheck } from '@/controllers/health.controller.js';
import { createLogsController } from '@/controllers/logs.controller.js';
import { analysisIdParamsSchema, analysisResponseSchema, analyzeBodySchema, analyzeResponseSchema } from '@/schemas/analysis.schema.js';
import { healthResponseSchema } from '@/schemas/health.schema.js';
import { listLogsQuerySchema, listLogsResponseSchema, logResponseSchema, logStatsQuerySchema, logStatsResponseSchema } from '@/schemas/logs.schema.js';
import type { AnalysisService } from '@/services/analysis.service.js';
import type { LogsService } from '@/services/logs.service.js';
import type { RouteDefinition } from './mount-routes.js';

export interface ApiRoutesDeps {
  logs: LogsService;
  analysis: AnalysisService;
  checkDatabase: DatabaseCheck;
  now: () => Date;
}

/** Every route under `/api`, in one table. */
export function createApiRoutes({ logs, analysis, checkDatabase, now }: ApiRoutesDeps): RouteDefinition[] {
  const logsController = createLogsController({ logs, now });
  const analysisController = createAnalysisController({ analysis });
  const { health } = createHealthController({ checkDatabase });

  return [
    {
      method: 'get',
      path: '/health',
      summary: 'Check that the API and its database are up',
      tags: ['health'],
      public: true,
      responses: { 200: healthResponseSchema },
      handler: health,
    },
    {
      method: 'post',
      path: '/logs',
      summary: 'Ingest a log',
      tags: ['logs'],
      request: { body: logsController.ingestBodySchema },
      responses: { 201: logResponseSchema },
      handler: logsController.ingest,
    },
    {
      method: 'get',
      path: '/logs',
      summary: 'List logs of every service, newest first',
      tags: ['logs'],
      request: { query: listLogsQuerySchema },
      responses: { 200: listLogsResponseSchema },
      handler: logsController.list,
    },
    {
      method: 'get',
      path: '/logs/stats',
      summary: 'Count logs by service and level',
      tags: ['logs'],
      request: { query: logStatsQuerySchema },
      responses: { 200: logStatsResponseSchema },
      handler: logsController.stats,
    },
    {
      method: 'post',
      path: '/logs/analyze',
      summary: 'Start an asynchronous analysis of one page of filtered logs',
      tags: ['analysis'],
      request: { body: analyzeBodySchema },
      responses: { 202: analyzeResponseSchema },
      handler: analysisController.start,
    },
    {
      method: 'get',
      path: '/analysis/:id',
      summary: 'Get the status and result of an analysis',
      tags: ['analysis'],
      request: { params: analysisIdParamsSchema },
      responses: { 200: analysisResponseSchema },
      handler: analysisController.get,
    },
  ];
}
