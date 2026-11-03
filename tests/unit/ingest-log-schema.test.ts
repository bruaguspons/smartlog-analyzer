import { describe, expect, it } from 'vitest';
import { createIngestLogBodySchema } from '../../src/modules/logs/http/ingest-log-schema.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const schema = createIngestLogBodySchema(() => NOW);
const valid = { level: 'INFO', timestamp: '2026-11-03T10:00:00Z', message: 'hello' };

function paths(body: unknown): string[] {
  const r = schema.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => '/' + i.path.join('/'));
}

describe('ingest log body schema', () => {
  it('accepts a minimal body and converts the timestamp to a Date', () => {
    const r = schema.safeParse(valid);
    expect(r.success && r.data.timestamp).toEqual(new Date('2026-11-03T10:00:00Z'));
  });

  it('S3/S4: rejects unknown keys (serviceId, id, trace_id)', () => {
    expect(schema.safeParse({ ...valid, serviceId: 9 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, id: 'x' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, trace_id: 't' }).success).toBe(false);
  });

  it('S7/S8: level is case-sensitive uppercase and required', () => {
    for (const level of ['info', 'TRACE']) expect(paths({ ...valid, level })).toEqual(['/level']);
    expect(paths({ timestamp: valid.timestamp, message: 'm' })).toEqual(['/level']);
    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']) {
      expect(schema.safeParse({ ...valid, level }).success).toBe(true);
    }
  });

  it('S9: rejects a timestamp without offset or a non-date', () => {
    expect(paths({ ...valid, timestamp: '2026-11-03T10:00:00' })).toEqual(['/timestamp']);
    expect(paths({ ...valid, timestamp: 'yesterday' })).toEqual(['/timestamp']);
  });

  it('S10: future skew boundary is inclusive at +5 min, +1 ms fails', () => {
    const at = (ms: number) => ({ ...valid, timestamp: new Date(NOW.getTime() + ms).toISOString() });
    expect(schema.safeParse(at(300_000)).success).toBe(true);
    expect(paths(at(300_001))).toEqual(['/timestamp']);
  });

  it('S11: accepts offsets and keeps the same instant', () => {
    const r = schema.safeParse({ ...valid, timestamp: '2026-11-03T08:00:00-03:00' });
    expect(r.success && r.data.timestamp.toISOString()).toBe('2026-11-03T11:00:00.000Z');
  });

  it('accepts 6-digit fractions', () => {
    expect(schema.safeParse({ ...valid, timestamp: '2026-11-03T10:00:00.123456Z' }).success).toBe(true);
  });

  it('S12: accepts timestamps years in the past', () => {
    expect(schema.safeParse({ ...valid, timestamp: '2001-01-01T00:00:00Z' }).success).toBe(true);
  });

  it('S13: message is 1..8192 characters', () => {
    expect(paths({ ...valid, message: '' })).toEqual(['/message']);
    expect(paths({ level: 'INFO', timestamp: valid.timestamp })).toEqual(['/message']);
    expect(paths({ ...valid, message: 5 })).toEqual(['/message']);
    expect(schema.safeParse({ ...valid, message: 'a'.repeat(8192) }).success).toBe(true);
    expect(paths({ ...valid, message: 'a'.repeat(8193) })).toEqual(['/message']);
  });

  it('S14: traceId is optional, 1..128 characters', () => {
    expect(paths({ ...valid, traceId: '' })).toEqual(['/traceId']);
    expect(paths({ ...valid, traceId: 'a'.repeat(129) })).toEqual(['/traceId']);
    expect(schema.safeParse({ ...valid, traceId: 'a'.repeat(128) }).success).toBe(true);
  });

  it('S15: metadata must be an object', () => {
    for (const metadata of [[], 'x', 1, null]) expect(paths({ ...valid, metadata })).toEqual(['/metadata']);
  });

  it('S16: metadata cap counts UTF-8 bytes (16384 passes, 16385 fails)', () => {
    // {"k":"..."} has 8 bytes of overhead; each "é" is 2 bytes.
    const sized = (bytes: number) => {
      const payload = bytes - 8;
      return { k: 'é'.repeat(Math.floor(payload / 2)) + 'a'.repeat(payload % 2) };
    };
    expect(Buffer.byteLength(JSON.stringify(sized(16_384)))).toBe(16_384);
    expect(schema.safeParse({ ...valid, metadata: sized(16_384) }).success).toBe(true);
    expect(paths({ ...valid, metadata: sized(16_385) })).toEqual(['/metadata']);
  });

  it('S17: accepts nested metadata unchanged', () => {
    const metadata = { a: { b: [1, 2] } };
    const r = schema.safeParse({ ...valid, metadata });
    expect(r.success && r.data.metadata).toEqual(metadata);
  });

  it('S18: reports every invalid field', () => {
    expect(paths({ ...valid, level: 'x', message: '' }).sort()).toEqual(['/level', '/message']);
  });
});
