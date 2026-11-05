import { describe, expect, it } from 'vitest';
import { backoffDelayMs } from '@/modules/analysis/application/run-analysis/retry/backoff-delay-ms.js';

describe('backoffDelayMs', () => {
  it('stays within +-25% of the doubling base for any random in [0, 1]', () => {
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      for (let n = 0; n < 5; n += 1) {
        const base = 1000 * 2 ** n;
        const delay = backoffDelayMs(n, random);
        expect(delay).toBeGreaterThanOrEqual(base * 0.75);
        expect(delay).toBeLessThanOrEqual(base * 1.25);
      }
    }
  });

  it('grows with the retry index for a fixed random and with random for a fixed index', () => {
    for (let n = 0; n < 4; n += 1) {
      expect(backoffDelayMs(n + 1, 0.5)).toBeGreaterThan(backoffDelayMs(n, 0.5));
      expect(backoffDelayMs(n, 0.9)).toBeGreaterThan(backoffDelayMs(n, 0.1));
    }
  });
});
