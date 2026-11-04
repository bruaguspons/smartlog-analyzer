import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { getAnalysis } from '../application/get-analysis.js';
import { startAnalysis, type StartAnalysisDeps } from '../application/start-analysis.js';
import { analysisResponseSchema } from './analysis-response-schema.js';
import { analysisIdParamsSchema, analyzeBodySchema, analyzeResponseSchema } from './analyze-schema.js';

export type AnalysisRoutesDeps = StartAnalysisDeps;

/** Factory because `buildApp({ apiRoutes })` registers plugins without options. */
export function createAnalysisRoutes(deps: AnalysisRoutesDeps): FastifyPluginAsyncZod {
  return (api) => {
    api.post(
      '/logs/analyze',
      {
        schema: {
          summary: 'Start an asynchronous analysis of one page of filtered logs',
          tags: ['analysis'],
          body: analyzeBodySchema,
          response: { 202: analyzeResponseSchema },
        },
      },
      async (request, reply) => {
        const { limit, cursor, ...filters } = request.body;
        // request.log carries the reqId, so the background job's logs can be traced to this request.
        const started = await startAnalysis({ filters, limit, cursor }, request.log, deps);
        return reply.status(202).send(started);
      },
    );
    api.get(
      '/analysis/:id',
      {
        schema: {
          summary: 'Get the status and result of an analysis',
          tags: ['analysis'],
          params: analysisIdParamsSchema,
          response: { 200: analysisResponseSchema },
        },
      },
      (request) => getAnalysis(request.params.id, { repo: deps.analysisRepo }),
    );
    return Promise.resolve();
  };
}
