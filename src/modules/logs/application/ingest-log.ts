import type { JsonObject, Log, LogLevel } from '../domain/log.js';
import type { LogRepository } from '../domain/log-repository.js';

export interface IngestLogCommand {
  /** Resolved from the API key by the caller, never from the request body. */
  serviceId: number;
  level: LogLevel;
  timestamp: Date;
  message: string;
  traceId?: string | undefined;
  metadata?: JsonObject | undefined;
}

export interface IngestLogDeps {
  repo: LogRepository;
  newId: () => string;
}

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
