import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApiDocument } from '@/app/openapi.js';
import type { RouteDefinition } from '@/routes/mount-routes.js';
import { createApiRoutes } from '@/routes/api.routes.js';

const noop: RouteDefinition['handler'] = () => undefined;
const apiRoutes = () =>
  createApiRoutes({ logs: undefined as never, analysis: undefined as never, checkDatabase: () => Promise.resolve(), now: () => new Date() });

const doc = () => buildOpenApiDocument(apiRoutes()) as unknown as {
  paths: Record<string, Record<string, { security?: unknown; requestBody?: unknown; responses: Record<string, unknown>; parameters?: { name: string; in: string }[] }>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
  security: unknown;
};

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((n) => collectRefs(n, out));
  else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') out.push(value);
      else collectRefs(value, out);
    }
  }
  return out;
}

function resolves(document: unknown, ref: string): boolean {
  let current: unknown = document;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
    if (current === null || typeof current !== 'object' || !(key in current)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return ref.startsWith('#/');
}

describe('buildOpenApiDocument', () => {
  it('declares the X-API-Key scheme and requires it by default', () => {
    expect(doc().components.securitySchemes.apiKey).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
    expect(doc().security).toEqual([{ apiKey: [] }]);
  });

  it('lists every route under /api with Express params turned into {braces}', () => {
    expect(Object.keys(doc().paths).sort()).toEqual(['/api/analysis/{id}', '/api/health', '/api/logs', '/api/logs/analyze', '/api/logs/stats']);
    expect(doc().paths['/api/analysis/{id}']?.get?.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path' })]);
  });

  it('documents the filters as query parameters, and no /docs path', () => {
    const names = doc().paths['/api/logs']?.get?.parameters?.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['serviceId', 'level', 'from', 'to', 'traceId', 'search', 'limit', 'cursor']));
    expect(Object.keys(doc().paths).some((p) => p.startsWith('/docs'))).toBe(false);
  });

  it('marks only the health route as public', () => {
    expect(doc().paths['/api/health']?.get?.security).toEqual([]);
    expect(doc().paths['/api/logs']?.get?.security).toBeUndefined();
  });

  it('reflects the zod schemas of an ad-hoc route', () => {
    const route: RouteDefinition = { method: 'post', path: '/echo', summary: 's', tags: [], request: { body: z.object({ message: z.string() }) }, responses: { 200: z.object({}) }, handler: noop };
    const document = buildOpenApiDocument([route]) as unknown as { paths: Record<string, { post: { requestBody: unknown } }> };
    expect(JSON.stringify(document.paths['/api/echo']?.post.requestBody)).toContain('message');
  });

  it('every $ref resolves to a node of the document', () => {
    const document = doc();
    expect(collectRefs(document).filter((ref) => !resolves(document, ref))).toEqual([]);
  });

  it('publishes the JSON value as a named component', () => {
    const document = doc();
    expect(Object.keys(document.components.schemas)).toEqual(expect.arrayContaining(['JsonValue']));
    expect(JSON.stringify(document.paths['/api/logs']?.post?.responses['201'])).toContain('#/components/schemas/JsonValue');
  });
});
