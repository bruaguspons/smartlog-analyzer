import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AnalysisRoutesDeps } from './create-analysis-routes.types.js';
import { registerGetAnalysisRoute } from '@/modules/analysis/http/get-analysis/get-analysis.route.js';
import { registerStartAnalysisRoute } from '@/modules/analysis/http/start-analysis/start-analysis.route.js';

/** Factory because `buildApp({ apiRoutes })` registers plugins without options. */
export function createAnalysisRoutes(deps: AnalysisRoutesDeps): FastifyPluginAsyncZod {
  return (api) => {
    registerStartAnalysisRoute(api, deps);
    registerGetAnalysisRoute(api, deps);
    return Promise.resolve();
  };
}
