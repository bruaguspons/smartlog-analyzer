import type { JsonObject, LogLevel } from '@/modules/logs/domain/log.types.js';
import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';

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
