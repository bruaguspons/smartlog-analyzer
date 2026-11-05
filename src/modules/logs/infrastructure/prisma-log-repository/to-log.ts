import type { JsonObject, Log } from '@/modules/logs/domain/log.types.js';
import type { LogRow } from './log-row.types.js';

export function toLog(row: LogRow): Log {
  return {
    id: row.id,
    serviceId: row.serviceId,
    level: row.level,
    timestamp: row.timestamp,
    message: row.message,
    traceId: row.traceId,
    // Written only by this repository from a validated JSON object, so the narrow cast is safe.
    metadata: row.metadata as JsonObject | null,
  };
}
