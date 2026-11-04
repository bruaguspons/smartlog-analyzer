import { describe, expect, it } from 'vitest';
import { encodeCursor } from '../../src/modules/logs/application/log-cursor.js';
import { listLogsQuerySchema } from '../../src/modules/logs/http/list-logs-schema.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const parse = (v: unknown) => listLogsQuerySchema.safeParse(v);

describe('listLogsQuerySchema', () => {
  it('defaults limit to 50', () => {
    expect(parse({}).data).toEqual({ limit: 50 });
  });

  it.each(['1', '200'])('accepts limit=%s', (limit) => {
    expect(parse({ limit }).data?.limit).toBe(Number(limit));
  });

  it.each(['0', '201', '-1', 'abc'])('rejects limit=%s', (limit) => {
    expect(parse({ limit }).success).toBe(false);
  });

  it.each([{ foo: '1' }, { levels: 'ERROR' }])('rejects unknown key %j', (q) => {
    expect(parse(q).success).toBe(false);
  });

  it.each([
    ['!!!'],
    [Buffer.from('not json').toString('base64url')],
    [Buffer.from('{"t":"x","i":1}').toString('base64url')],
    [''],
  ])('invalid cursor %j gives an issue at /cursor', (cursor) => {
    const r = parse({ cursor });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['cursor']);
  });

  it('decodes a valid cursor into a LogCursor', () => {
    const timestamp = new Date('2026-11-03T10:00:00.123Z');
    const r = parse({ cursor: encodeCursor({ timestamp, id: ID }) });
    expect(r.data?.cursor).toEqual({ timestamp, id: ID });
  });

  it('applies the shared date range check', () => {
    const r = parse({ from: '2026-01-02T00:00:00Z', to: '2026-01-01T00:00:00Z' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['from']);
  });
});
