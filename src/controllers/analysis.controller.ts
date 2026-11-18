import type { RequestHandler } from 'express';
import {
  analysisIdParamsSchema,
  analysisResponseSchema,
  analyzeBodySchema,
  analyzeResponseSchema,
} from '@/schemas/analysis.schema.js';
import { analysisService } from '@/services/analysis.service.js';
import { parseRequest, sendJson } from './request-io.js';

const start: RequestHandler = async (req, res) => {
  // Validate the body
  const { limit, cursor, ...filters } = parseRequest('body', analyzeBodySchema, req.body);
  // req.log carries the request id, so the background job's logs can be traced to this request.
  const started = await analysisService.start({ filters, limit, cursor }, req.log);
  // Reply with the started analysis
  sendJson(res, 202, analyzeResponseSchema, started);
};

const get: RequestHandler = async (req, res) => {
  const { id } = parseRequest('params', analysisIdParamsSchema, req.params);
  sendJson(res, 200, analysisResponseSchema, await analysisService.get(id));
};

export const analysisController = { start, get };
