import type { ZodApi } from '@/shared/http/zod-api.types.js';
import type { AnalysisRoutesDeps } from '@/modules/analysis/http/create-analysis-routes.types.js';
import { analyzeBodySchema, analyzeResponseSchema } from '@/schemas/analysis.schema.js';

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
      const started = await deps.analysis.start({ filters, limit, cursor }, request.log);
      return reply.status(202).send(started);
    },
  );
}
