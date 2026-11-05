import type { SampleSpec } from './seed-logs.types.js';

/**
 * Fixed instant the sample timestamps are measured back from. Fixed (not the seed's `now`) so
 * the data always falls inside the date range Swagger pre-fills, however long ago the seed ran.
 */
export const SAMPLE_LOGS_END = new Date('2026-11-01T12:00:00.000Z');

// Fixed content: a coherent DB-timeout incident (traces 0001 and 0002, the first one crossing
// both services) surrounded by routine traffic, so POST /api/logs/analyze has real material.
export const SAMPLE_SPECS: readonly SampleSpec[] = [
  {
    service: 'payments',
    minutesAgo: 120,
    level: 'INFO',
    message: 'Payments API started',
    traceId: null,
    metadata: { version: '1.4.2' },
  },
  {
    service: 'orders',
    minutesAgo: 118,
    level: 'INFO',
    message: 'Orders API started',
    traceId: null,
    metadata: { version: '2.0.1' },
  },
  {
    service: 'payments',
    minutesAgo: 90,
    level: 'DEBUG',
    message: 'Payment gateway client initialized',
    traceId: null,
    metadata: null,
  },
  {
    service: 'orders',
    minutesAgo: 60,
    level: 'INFO',
    message: 'Order 1042 created',
    traceId: null,
    metadata: { orderId: 1042, items: 3 },
  },
  {
    service: 'orders',
    minutesAgo: 30,
    level: 'WARN',
    message: 'Slow query on orders table (1800 ms)',
    traceId: null,
    metadata: { durationMs: 1800 },
  },
  {
    service: 'orders',
    minutesAgo: 20,
    level: 'INFO',
    message: 'Checkout started for order 1043',
    traceId: 'seed-trace-0001',
    metadata: { orderId: 1043 },
  },
  {
    service: 'payments',
    minutesAgo: 19,
    level: 'INFO',
    message: 'Charge requested for order 1043',
    traceId: 'seed-trace-0001',
    metadata: { orderId: 1043, amount: 59.9 },
  },
  {
    service: 'payments',
    minutesAgo: 18,
    level: 'WARN',
    message: 'Connection pool at 95% capacity',
    traceId: 'seed-trace-0001',
    metadata: { pool: { used: 19, max: 20 } },
  },
  {
    service: 'payments',
    minutesAgo: 17,
    level: 'ERROR',
    message: 'Database query timed out after 5000 ms',
    traceId: 'seed-trace-0001',
    metadata: { timeoutMs: 5000 },
  },
  {
    service: 'orders',
    minutesAgo: 16,
    level: 'ERROR',
    message: 'Payment service call failed for order 1043: upstream timeout',
    traceId: 'seed-trace-0001',
    metadata: { orderId: 1043 },
  },
  {
    service: 'payments',
    minutesAgo: 10,
    level: 'ERROR',
    message: 'Database query timed out after 5000 ms',
    traceId: 'seed-trace-0002',
    metadata: { timeoutMs: 5000 },
  },
  {
    service: 'payments',
    minutesAgo: 9,
    level: 'FATAL',
    message: 'Connection pool exhausted, cannot acquire connection',
    traceId: 'seed-trace-0002',
    metadata: null,
  },
  {
    service: 'orders',
    minutesAgo: 3,
    level: 'INFO',
    message: 'Health check passed',
    traceId: null,
    metadata: null,
  },
];

export const SAMPLE_LOG_COUNT = SAMPLE_SPECS.length;
