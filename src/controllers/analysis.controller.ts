import type { RequestHandler } from 'express';
import { analysisIdParamsSchema, analysisResponseSchema, analyzeBodySchema, analyzeResponseSchema } from '@/schemas/analysis.schema.js';
import type { AnalysisService } from '@/services/analysis.service.js';
import { parseRequest, sendJson } from './request-io.js';

export interface AnalysisControllerDeps {
  analysis: AnalysisService;
}

export function createAnalysisController({ analysis }: AnalysisControllerDeps) {
  const start: RequestHandler = async (req, res) => {
    const { limit, cursor, ...filters } = parseRequest('body', analyzeBodySchema, req.body);
    // req.log carries the request id, so the background job's logs can be traced to this request.
    const started = await analysis.start({ filters, limit, cursor }, req.log);
    sendJson(res, 202, analyzeResponseSchema, started);
  };

  const get: RequestHandler = async (req, res) => {
    const { id } = parseRequest('params', analysisIdParamsSchema, req.params);
    sendJson(res, 200, analysisResponseSchema, await analysis.get(id));
  };

  return { start, get };
}
