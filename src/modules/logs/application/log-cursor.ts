import { z } from 'zod';
import type { LogCursor } from '../domain/log-filters.js';

const cursorPayloadSchema = z.strictObject({ t: z.iso.datetime(), i: z.uuid() });
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Opaque to clients: base64url of JSON `{ t: ISO timestamp (ms), i: id }`. */
export function encodeCursor(cursor: LogCursor): string {
  const payload = { t: cursor.timestamp.toISOString(), i: cursor.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Returns `null` for anything that is not a cursor produced by `encodeCursor`. */
export function decodeCursor(raw: string): LogCursor | null {
  if (!BASE64URL.test(raw)) return null;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = cursorPayloadSchema.safeParse(json);
  if (!parsed.success) return null;
  return { timestamp: new Date(parsed.data.t), id: parsed.data.i };
}
