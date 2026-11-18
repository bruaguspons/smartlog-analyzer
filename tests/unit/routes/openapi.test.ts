import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildOpenApiDocument, documentRoute } from '@/routes/openapi.js';
import { jsonValueSchema } from '@/schemas/logs.schema.js';

type Doc = {
  paths: Record<string, Record<string, { security?: unknown; requestBody?: unknown; responses: Record<string, unknown>; parameters?: { name: string; in: string }[] }>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
  security: unknown;
};
const doc = () => buildOpenApiDocument() as unknown as Doc;

// The registry is process-wide (each router registers its paths when it is imported), so this file
// registers its own throwaway routes once.
documentRoute({ method: 'get', path: '/items/:id', summary: 'Get an item', tags: ['items'], params: z.object({ id: z.string() }), responses: { 200: z.object({ id: z.string() }) } });
documentRoute({ method: 'get', path: '/items', summary: 'List items', tags: ['items'], query: z.object({ limit: z.string().optional(), search: z.string().optional() }), responses: { 200: z.object({}) } });
documentRoute({ method: 'post', path: '/items', summary: 'Create an item', tags: ['items'], body: z.object({ message: z.string(), extra: jsonValueSchema }), responses: { 201: z.object({ extra: jsonValueSchema }) } });
documentRoute({ method: 'get', path: '/open', summary: 'Public', tags: ['items'], public: true, responses: { 200: z.object({}) } });

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

describe('documentRoute and buildOpenApiDocument', () => {
  it('declares the X-API-Key scheme and requires it by default', () => {
    expect(doc().components.securitySchemes.apiKey).toMatchObject({ type: 'apiKey', in: 'header', name: 'X-API-Key' });
    expect(doc().security).toEqual([{ apiKey: [] }]);
  });

  it('lists every registered route under /api with Express params turned into {braces}', () => {
    expect(Object.keys(doc().paths).sort()).toEqual(['/api/items', '/api/items/{id}', '/api/open']);
    expect(doc().paths['/api/items/{id}']?.get?.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path' })]);
  });

  it('documents the query schema as query parameters', () => {
    const names = doc().paths['/api/items']?.get?.parameters?.map((p) => p.name);
    expect(names).toEqual(['limit', 'search']);
  });

  it('documents the body schema as a required JSON request body', () => {
    expect(JSON.stringify(doc().paths['/api/items']?.post?.requestBody)).toContain('message');
  });

  it('marks only the public route as not needing the key', () => {
    expect(doc().paths['/api/open']?.get?.security).toEqual([]);
    expect(doc().paths['/api/items']?.get?.security).toBeUndefined();
  });

  it('every $ref resolves to a node of the document', () => {
    const document = doc();
    expect(collectRefs(document).filter((ref) => !resolves(document, ref))).toEqual([]);
  });

  it('publishes the JSON value as a named component', () => {
    const document = doc();
    expect(Object.keys(document.components.schemas)).toEqual(expect.arrayContaining(['JsonValue']));
    expect(JSON.stringify(document.paths['/api/items']?.post?.responses['201'])).toContain('#/components/schemas/JsonValue');
  });
});
