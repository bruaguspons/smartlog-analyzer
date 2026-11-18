import type { ZodApi } from '@/shared/http/zod-api.types.js';
import type { AnalysisRoutesDeps } from '@/modules/analysis/http/create-analysis-routes.types.js';
import { analysisIdParamsSchema, analysisResponseSchema } from '@/schemas/analysis.schema.js';

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
    (request) => deps.analysis.get(request.params.id),
  );
}
