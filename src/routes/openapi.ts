import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import type { z } from 'zod';

export const API_PREFIX = '/api';

/** One documented route. Each router file registers its own, next to the routes it mounts. */
export interface RouteDoc {
  method: 'get' | 'post';
  /** Relative to `/api`, Express syntax (`/analysis/:id`). */
  path: string;
  summary: string;
  tags: string[];
  /** Skips the `X-API-Key` requirement (only the health probe). */
  public?: true;
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
  responses: Record<number, z.ZodType>;
}

const registry = new OpenAPIRegistry();

/** `/analysis/:id` (Express) -> `/api/analysis/{id}` (OpenAPI). */
const toOpenApiPath = (path: string) => `${API_PREFIX}${path.replace(/:(\w+)/g, '{$1}')}`;

/** Adds a route to the OpenAPI document. Paths appear in registration order. */
export function documentRoute({ method, path, summary, tags, public: isPublic, body, query, params, responses }: RouteDoc): void {
  registry.registerPath({
    method,
    path: toOpenApiPath(path),
    summary,
    tags,
    ...(isPublic && { security: [] }),
    request: {
      ...(body && { body: { required: true, content: { 'application/json': { schema: body } } } }),
      ...(query && { query: query as never }),
      ...(params && { params: params as never }),
    },
    responses: Object.fromEntries(
      Object.entries(responses).map(([status, schema]) => [
        status,
        { description: `Response ${status}`, content: { 'application/json': { schema } } },
      ]),
    ),
  });
}

registry.registerComponent('securitySchemes', 'apiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  // Shown in the Swagger UI "Authorize" dialog. Seed values, not secrets.
  description: 'Dev keys from the seed: dev-key-payments-0001 (payments-api), dev-key-orders-0002 (orders-api). dev-key-legacy-0003 is inactive and returns 401.',
});

/** Builds the document from every route registered so far: import the routers first. */
export function buildOpenApiDocument() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: { title: 'SmartLog Analyzer API', version: '0.0.0' },
    security: [{ apiKey: [] }],
  });
}
