import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '@/app/build-app.js';
import { createLogsRoutes } from '@/modules/logs/http/create-logs-routes.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '@/modules/services/domain/service.types.js';
import { InMemoryServiceRepository } from '@/modules/services/infrastructure/in-memory-service-repository.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const NOW = new Date('2026-11-03T12:00:00.000Z');
const active: Service = { id: 7, name: 'svc', description: null, apiKey: 'k-active', isActive: true };

describe('OpenAPI document', () => {
  let app: FastifyInstance;

  afterEach(() => app.close());

  async function swaggerDoc() {
    const serviceRepo = new InMemoryServiceRepository([active]);
    app = buildApp({
      serviceRepository: serviceRepo,
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [createLogsRoutes({ repo: new InMemoryLogRepository(), serviceRepo, newId: () => ID, now: () => NOW })],
      logLevel: 'silent',
    });
    await app.ready();
    return app.swagger() as unknown as Record<string, unknown>;
  }

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

  function resolves(doc: unknown, ref: string): boolean {
    if (!ref.startsWith('#/')) return false;
    let current: unknown = doc;
    for (const part of ref.slice(2).split('/')) {
      const key = part.replaceAll('~1', '/').replaceAll('~0', '~');
      if (current === null || typeof current !== 'object' || !(key in current)) return false;
      current = (current as Record<string, unknown>)[key];
    }
    return true;
  }

  it('every $ref resolves to a node of the document', async () => {
    const doc = await swaggerDoc();
    const unresolved = collectRefs(doc).filter((ref) => !resolves(doc, ref));
    expect(unresolved).toEqual([]);
  });

  it('publishes the JSON value as named components, without leaking shared definitions', async () => {
    const doc = await swaggerDoc();
    const schemas = (doc.components as { schemas: Record<string, unknown> }).schemas;
    const post = (doc.paths as Record<string, Record<string, unknown>>)['/api/logs']?.post;

    expect(Object.keys(schemas)).not.toContain('__shared');
    expect(schemas).toHaveProperty('JsonValueInput');
    expect(schemas).toHaveProperty('JsonValue');
    const { requestBody, responses } = post as { requestBody: unknown; responses: Record<string, unknown> };
    expect(JSON.stringify(requestBody)).toContain('#/components/schemas/JsonValueInput');
    expect(JSON.stringify(responses['201'])).toContain('#/components/schemas/JsonValue"');
  });
});
