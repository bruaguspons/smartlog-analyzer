import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../../src/modules/logs/application/log-cursor.js';
import {
  analysisIdParamsSchema,
  analyzeBodySchema,
  analyzeResponseSchema,
} from '../../src/modules/analysis/http/analyze-schema.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const parse = (v: unknown) => analyzeBodySchema.safeParse(v);

describe('analyzeBodySchema', () => {
  it('accepts an empty body and defaults limit to 50', () => {
    expect(parse({}).data).toEqual({ limit: 50 });
  });

  it('accepts the shared filters as JSON', () => {
    const result = parse({
      serviceId: 3,
      level: ['ERROR', 'FATAL'],
      from: '2026-11-04T00:00:00Z',
      to: '2026-11-04T23:59:59Z',
      traceId: 't-1',
      search: 'timeout',
      limit: 200,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ serviceId: 3, level: ['ERROR', 'FATAL'], limit: 200, from: new Date('2026-11-04T00:00:00Z') });
  });

  it('S3: rejects limit above 200 and below 1', () => {
    expect(parse({ limit: 201 }).success).toBe(false);
    expect(parse({ limit: 0 }).success).toBe(false);
  });

  it.each([{ foo: 1 }, { levels: ['ERROR'] }])('rejects unknown key %j', (body) => {
    expect(parse(body).success).toBe(false);
  });

  it('rejects from after to', () => {
    expect(parse({ from: '2026-11-05T00:00:00Z', to: '2026-11-04T00:00:00Z' }).success).toBe(false);
  });

  it('decodes a valid cursor and rejects a malformed one', () => {
    const cursor = encodeCursor({ timestamp: new Date('2026-11-04T10:00:00.000Z'), id: ID });
    expect(parse({ cursor }).data?.cursor).toEqual({ timestamp: new Date('2026-11-04T10:00:00.000Z'), id: ID });
    expect(parse({ cursor: '!!!' }).success).toBe(false);
  });
});

describe('analyzeResponseSchema', () => {
  it('accepts id, hasMore and a nullable nextCursor', () => {
    expect(analyzeResponseSchema.safeParse({ id: ID, hasMore: false, nextCursor: null }).success).toBe(true);
    expect(analyzeResponseSchema.safeParse({ id: 'nope', hasMore: false, nextCursor: null }).success).toBe(false);
  });
});

describe('analysisIdParamsSchema', () => {
  it('S12: accepts a UUID and rejects anything else', () => {
    expect(analysisIdParamsSchema.safeParse({ id: ID }).success).toBe(true);
    expect(analysisIdParamsSchema.safeParse({ id: '123' }).success).toBe(false);
  });
});
