import type { LogFilters, LogPageRequest } from './log-filters.types.js';
import type { Log, LogLevel } from './log.types.js';

/** Raw count of logs for one (service, level) pair; names are resolved by the caller. */
export interface LogCountGroup {
  serviceId: number;
  level: LogLevel;
  count: number;
}

export interface LogRepository {
  create(log: Log): Promise<Log>;
  /**
   * At most `page.take` logs matching every filter, ordered `(timestamp DESC, id DESC)`,
   * strictly after `page.cursor` when given.
   */
  list(filters: LogFilters, page: LogPageRequest): Promise<Log[]>;
  /** One group per (service, level) with at least one log matching every filter; order unspecified. */
  countByServiceAndLevel(filters: LogFilters): Promise<LogCountGroup[]>;
}
