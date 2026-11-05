import { z } from 'zod';
import type { LogCursor } from '@/modules/logs/domain/log-filters.types.js';

const cursorPayloadSchema = z.strictObject({ t: z.iso.datetime(), i: z.uuid() });
const BASE64URL = /^[A-Za-z0-9_-]+$/;

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
