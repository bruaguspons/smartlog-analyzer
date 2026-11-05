/**
 * Postgres cannot store U+0000 in `text` (22021) or `jsonb` (22P05), so such input would surface as a 500.
 * It is rejected up front (400) rather than stripped, which would silently alter what the client sent.
 * Walks strings, array items, and object keys and values; the check is on code units, so the literal
 * text backslash + "u0000" is not a false positive.
 */
export function hasNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(hasNul);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).some(([key, item]) => hasNul(key) || hasNul(item));
  }
  return false;
}
