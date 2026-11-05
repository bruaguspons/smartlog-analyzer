const BASE_DELAY_MS = 1000;

/** `1000 * 2^retryIndex` jittered by +-25%; `random` is in [0, 1]. Retry-After is deliberately ignored. */
export function backoffDelayMs(retryIndex: number, random: number): number {
  return BASE_DELAY_MS * 2 ** retryIndex * (0.75 + random * 0.5);
}
