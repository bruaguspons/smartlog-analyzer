import type { Log } from '@/modules/logs/domain/log.types.js';
import { SAMPLE_LOGS_END, SAMPLE_SPECS } from './sample-specs.const.js';
import type { SampleServiceIds, SeedLogsDeps } from './seed-logs.types.js';

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
