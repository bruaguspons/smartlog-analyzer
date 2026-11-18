import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { RouteDefinition } from '@/routes/mount-routes.js';

export const API_PREFIX = '/api';

/** `/analysis/:id` (Express) -> `/api/analysis/{id}` (OpenAPI). */
const toOpenApiPath = (path: string) => `${API_PREFIX}${path.replace(/:(\w+)/g, '{$1}')}`;

/** Builds the document from the same route table that is mounted, so paths and schemas cannot drift. */
export function buildOpenApiDocument(routes: readonly RouteDefinition[]) {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'apiKey', {
    type: 'apiKey',
    in: 'header',
    name: 'X-API-Key',
    // Shown in the Swagger UI "Authorize" dialog. Seed values, not secrets.
    description: 'Dev keys from the seed: dev-key-payments-0001 (payments-api), dev-key-orders-0002 (orders-api). dev-key-legacy-0003 is inactive and returns 401.',
  });

  for (const route of routes) {
    const { body, query, params } = route.request ?? {};
    registry.registerPath({
      method: route.method,
      path: toOpenApiPath(route.path),
      summary: route.summary,
      tags: route.tags,
      ...(route.public && { security: [] }),
      request: {
        ...(body && { body: { required: true, content: { 'application/json': { schema: body } } } }),
        ...(query && { query: query as never }),
        ...(params && { params: params as never }),
      },
      responses: Object.fromEntries(
        Object.entries(route.responses).map(([status, schema]) => [
          status,
          { description: `Response ${status}`, content: { 'application/json': { schema } } },
        ]),
      ),
    });
  }

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: { title: 'SmartLog Analyzer API', version: '0.0.0' },
    security: [{ apiKey: [] }],
  });
}
