import type { JsonObject, Log, LogLevel } from '@/models/log.js';
import type { PrismaClient } from '@/shared/db/generated/client.js';
import { SAMPLE_LOGS_END, SAMPLE_SPECS } from './sample-logs.const.js';
import { DEV_SERVICES } from './seed-services.js';

export interface SeedLogsDeps {
  newId: () => string;
}

/** Database ids of the two active dev services that own the sample logs. */
export interface SampleServiceIds {
  payments: number;
  orders: number;
}

export interface SampleSpec {
  service: keyof SampleServiceIds;
  /** Minutes before `SAMPLE_LOGS_END`. */
  minutesAgo: number;
  level: LogLevel;
  message: string;
  traceId: string | null;
  metadata: JsonObject | null;
}

/** Pure and deterministic given `deps`: ids come from `newId`, timestamps from `SAMPLE_LOGS_END`. */
export function buildSampleLogs(ids: SampleServiceIds, deps: SeedLogsDeps): Log[] {
  const end = SAMPLE_LOGS_END.getTime();
  return SAMPLE_SPECS.map((spec) => ({
    id: deps.newId(),
    serviceId: ids[spec.service],
    level: spec.level,
    timestamp: new Date(end - spec.minutesAgo * 60_000),
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
