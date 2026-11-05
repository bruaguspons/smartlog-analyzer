import type { Log } from '@/modules/logs/domain/log.types.js';
import type { IngestLogCommand, IngestLogDeps } from './ingest-log.types.js';

export function ingestLog(cmd: IngestLogCommand, deps: IngestLogDeps): Promise<Log> {
  return deps.repo.create({
    id: deps.newId(),
    serviceId: cmd.serviceId,
    level: cmd.level,
    timestamp: cmd.timestamp,
    message: cmd.message,
    traceId: cmd.traceId ?? null,
    metadata: cmd.metadata ?? null,
  });
}
