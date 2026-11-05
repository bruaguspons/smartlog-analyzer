import type { ZodApi } from '@/shared/http/zod-api.types.js';
import type { AnalysisRoutesDeps } from '@/modules/analysis/http/create-analysis-routes.types.js';
import { getAnalysis } from '@/modules/analysis/application/get-analysis/get-analysis.js';
import { analysisIdParamsSchema, analysisResponseSchema } from './get-analysis.schema.js';

export function registerGetAnalysisRoute(api: ZodApi, deps: AnalysisRoutesDeps): void {
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
}
