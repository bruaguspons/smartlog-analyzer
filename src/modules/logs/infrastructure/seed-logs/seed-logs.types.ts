import type { JsonObject, LogLevel } from '@/modules/logs/domain/log.types.js';

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
