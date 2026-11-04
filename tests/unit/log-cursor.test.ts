import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/modules/logs/application/log-cursor.js';

const ID = '0192f1c0-0000-7000-8000-000000000001';
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const cursorOf = (o: unknown) => b64(JSON.stringify(o));

describe('log cursor codec', () => {
  it('round-trips with millisecond precision', () => {
    const c = { timestamp: new Date('2026-11-03T10:00:00.123Z'), id: ID };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded).toEqual(c);
    expect(decoded?.timestamp.toISOString()).toBe('2026-11-03T10:00:00.123Z');
  });

  it('produces an opaque base64url string', () => {
    expect(encodeCursor({ timestamp: new Date(0), id: ID })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['empty string', ''],
    ['invalid characters', '!!!'],
    ['non-JSON payload', b64('not json')],
    ['extra keys', cursorOf({ t: '2026-11-03T10:00:00.123Z', i: ID, x: 1 })],
    ['non-uuid id', cursorOf({ t: '2026-11-03T10:00:00.123Z', i: '1' })],
    ['non-ISO timestamp', cursorOf({ t: 'x', i: ID })],
    ['truncated', encodeCursor({ timestamp: new Date(0), id: ID }).slice(0, -6)],
  ])('returns null for %s', (_name, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
