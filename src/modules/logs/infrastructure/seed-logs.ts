import type { PrismaClient } from '../../../shared/db/generated/client.js';
import { DEV_SERVICES } from '../../services/infrastructure/seed-services.js';
import type { JsonObject, Log, LogLevel } from '../domain/log.js';

export interface SeedLogsDeps {
  newId: () => string;
  now: () => Date;
}

/** Database ids of the two active dev services that own the sample logs. */
export interface SampleServiceIds {
  payments: number;
  orders: number;
}

interface SampleSpec {
  service: keyof SampleServiceIds;
  /** Minutes before `now`. */
  minutesAgo: number;
  level: LogLevel;
  message: string;
  traceId: string | null;
  metadata: JsonObject | null;
}

// Fixed content: a coherent DB-timeout incident (traces 0001 and 0002, the first one crossing
// both services) surrounded by routine traffic, so POST /api/logs/analyze has real material.
const SAMPLE_SPECS: readonly SampleSpec[] = [
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

/** Pure and deterministic given `deps`: ids come from `newId`, timestamps are relative to `now`. */
export function buildSampleLogs(ids: SampleServiceIds, deps: SeedLogsDeps): Log[] {
  const now = deps.now().getTime();
  return SAMPLE_SPECS.map((spec) => ({
    id: deps.newId(),
    serviceId: ids[spec.service],
    level: spec.level,
    timestamp: new Date(now - spec.minutesAgo * 60_000),
    message: spec.message,
    traceId: spec.traceId,
    metadata: spec.metadata,
  }));
}

/**
 * Inserts the sample logs only when `logs` is empty; returns how many rows were inserted.
 * The count-then-insert is deliberately not atomic: the seed runs once per container start,
 * before the server and on a single instance. The worst case is duplicate dev rows with
 * distinct UUIDs, which breaks no constraint (unlike the single in-flight analysis rule, which
 * guards an invariant with a unique index).
 */
export async function seedLogs(prisma: PrismaClient, deps: SeedLogsDeps): Promise<number> {
  if ((await prisma.log.count()) > 0) return 0;

  const [payments, orders] = [DEV_SERVICES[0].apiKey, DEV_SERVICES[1].apiKey];
  const rows = await prisma.service.findMany({
    where: { apiKey: { in: [payments, orders] } },
  });
  const idByKey = new Map(rows.map((row) => [row.apiKey, row.id]));
  const paymentsId = idByKey.get(payments);
  const ordersId = idByKey.get(orders);
  if (paymentsId === undefined || ordersId === undefined) {
    throw new Error('Dev services are missing: run seedServices before seedLogs');
  }

  const logs = buildSampleLogs({ payments: paymentsId, orders: ordersId }, deps);
  const result = await prisma.log.createMany({
    data: logs.map(({ metadata, ...log }) => ({
      ...log,
      ...(metadata !== null && { metadata }),
    })),
  });
  return result.count;
}
