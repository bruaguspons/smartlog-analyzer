import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { analyzeBodySchema } from '../../src/modules/analysis/http/analyze-schema.js';
import { listLogsQuerySchema } from '../../src/modules/logs/http/list-logs-schema.js';
import { logStatsQuerySchema } from '../../src/modules/logs/http/log-stats-schema.js';
import {
  checkDateRange,
  logFiltersShape,
} from '../../src/modules/logs/http/log-filters-schema.js';

const schema = z.strictObject(logFiltersShape).superRefine(checkDateRange);
const ok = (v: unknown) => schema.safeParse(v);
const bad = (v: unknown) => expect(schema.safeParse(v).success).toBe(false);

describe('log filters schema', () => {
  it('serviceId: coerces a numeric string, rejects non-positive and non-numeric', () => {
    expect(ok({ serviceId: '1' }).data).toEqual({ serviceId: 1 });
    bad({ serviceId: 'abc' });
    bad({ serviceId: '0' });
    bad({ serviceId: '-1' });
  });

  it('level: single string becomes a one-element array, repeated stays an array', () => {
    expect(ok({ level: 'ERROR' }).data).toEqual({ level: ['ERROR'] });
    expect(ok({ level: ['ERROR', 'FATAL'] }).data).toEqual({ level: ['ERROR', 'FATAL'] });
  });

  it.each(['TRACE', 'error', 'ERROR,FATAL'])('level: rejects %s', (level) => {
    bad({ level });
  });

  it('level: rejects an empty array', () => {
    bad({ level: [] });
  });

  it('from/to: accepts ISO with offset and normalizes to the same instant', () => {
    const r = ok({ from: '2026-01-01T02:00:00+02:00', to: '2026-01-01T00:00:00Z' });
    expect(r.success).toBe(true);
    expect(r.data?.from?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(r.data?.from?.getTime()).toBe(r.data?.to?.getTime());
  });

  it.each(['2026-01-01', 'garbage'])('from: rejects %s', (from) => {
    bad({ from });
  });

  it('from > to is an issue at path from; from == to is fine', () => {
    const r = ok({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['from']);
    expect(ok({ from: '2026-01-01T00:00:00Z', to: '2026-01-01T00:00:00Z' }).success).toBe(true);
  });

  it('traceId: rejects empty', () => {
    bad({ traceId: '' });
    expect(ok({ traceId: 'abc' }).data).toEqual({ traceId: 'abc' });
  });

  it('search: trims, rejects empty/blank, caps at 256 after trim', () => {
    expect(ok({ search: '  db  ' }).data).toEqual({ search: 'db' });
    bad({ search: '' });
    bad({ search: '  ' });
    expect(ok({ search: 'a'.repeat(256) }).success).toBe(true);
    bad({ search: 'a'.repeat(257) });
  });

  it('serviceId: accepts the Int4 maximum, rejects anything beyond or malformed', () => {
    expect(ok({ serviceId: '2147483647' }).data).toEqual({ serviceId: 2147483647 });
    for (const serviceId of ['2147483648', '0', '-1', '1.5', 'abc']) bad({ serviceId });
  });

  it('search/traceId: reject a NUL byte but accept literal backslash-u text', () => {
    bad({ search: 'a\u0000b' });
    bad({ traceId: 'a\u0000b' });
    expect(ok({ search: 'a\\u0000b' }).success).toBe(true);
    expect(ok({ traceId: 'a\\u0000b' }).success).toBe(true);
  });

  describe('the shared rules reach every endpoint schema', () => {
    const schemas = { list: listLogsQuerySchema, stats: logStatsQuerySchema, analyze: analyzeBodySchema };

    it.each(Object.entries(schemas))('%s rejects out-of-range serviceId and NUL bytes', (_name, endpoint) => {
      for (const input of [{ serviceId: '2147483648' }, { search: 'a\u0000b' }, { traceId: 'a\u0000b' }]) {
        expect(endpoint.safeParse(input).success).toBe(false);
      }
      expect(endpoint.safeParse({ serviceId: '2147483647' }).success).toBe(true);
    });
  });
});
