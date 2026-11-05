/** Postgres LIKE treats `\\`, `%` and `_` as special; escape them so the search is a literal. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
