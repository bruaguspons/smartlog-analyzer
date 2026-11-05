import type { ZodApi } from '@/shared/http/zod-api.types.js';
import type { AnalysisRoutesDeps } from '@/modules/analysis/http/create-analysis-routes.types.js';
import { startAnalysis } from '@/modules/analysis/application/start-analysis/start-analysis.js';
import { analyzeBodySchema, analyzeResponseSchema } from './start-analysis.schema.js';

export function registerStartAnalysisRoute(api: ZodApi, deps: AnalysisRoutesDeps): void {
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
}
