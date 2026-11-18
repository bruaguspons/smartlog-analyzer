import { Router } from 'express';
import { analysisController } from '@/controllers/analysis.controller.js';
import { parseJsonBody } from '@/middlewares/parse-json-body.js';
import { requireApiKey } from '@/middlewares/require-api-key.js';
import { analysisIdParamsSchema, analysisResponseSchema, analyzeBodySchema, analyzeResponseSchema } from '@/schemas/analysis.schema.js';
import { documentRoute } from './openapi.js';

export const analysisRouter = Router({ strict: true, caseSensitive: true });
const json = parseJsonBody();

documentRoute({
  method: 'post',
  path: '/logs/analyze',
  summary: 'Start an asynchronous analysis of one page of filtered logs',
  tags: ['analysis'],
  body: analyzeBodySchema,
  responses: { 202: analyzeResponseSchema },
});
analysisRouter.post('/logs/analyze', requireApiKey, json, analysisController.start);

documentRoute({
  method: 'get',
  path: '/analysis/:id',
  summary: 'Get the status and result of an analysis',
  tags: ['analysis'],
  params: analysisIdParamsSchema,
  responses: { 200: analysisResponseSchema },
});
analysisRouter.get('/analysis/:id', requireApiKey, analysisController.get);
