import { describe, expect, it } from 'vitest';
import { z } from 'zod';
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
});
