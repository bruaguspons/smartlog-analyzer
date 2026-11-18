import type { Log } from '@/models/log.js';
import type { Service } from '@/models/service.js';

const uuid = (prefix: string, n: number) => `0192f1c0-${prefix}-7000-8000-${String(n).padStart(12, '0')}`;

/** Deterministic ids: the number keeps them ordered and readable in assertions. */
export const analysisId = (n: number) => uuid('aaaa', n);
export const logId = (n: number) => uuid('bbbb', n);

export const makeService = (id: number, overrides: Partial<Service> = {}): Service => ({
  id,
  name: `svc-${String(id)}`,
  description: null,
  apiKey: `key-${String(id)}`,
  isActive: true,
  ...overrides,
});

/** A log of service 1 whose timestamp grows with `n` (one second apart, from 10:00:00). */
export function makeLog(n: number, overrides: Partial<Log> = {}): Log {
  return {
    id: logId(n),
    serviceId: 1,
    level: 'INFO',
    timestamp: new Date(`2026-11-03T10:00:${String(n).padStart(2, '0')}.000Z`),
    message: `message ${String(n)}`,
    traceId: null,
    metadata: null,
    ...overrides,
  };
}
