import type { LogCursor } from '@/modules/logs/domain/log-filters.types.js';

/** Opaque to clients: base64url of JSON `{ t: ISO timestamp (ms), i: id }`. */
export function encodeCursor(cursor: LogCursor): string {
  const payload = { t: cursor.timestamp.toISOString(), i: cursor.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
