import type { LogFilters, LogPageRequest } from './log-filters.js';
import type { Log } from './log.js';

export interface LogRepository {
  create(log: Log): Promise<Log>;
  /**
   * At most `page.take` logs matching every filter, ordered `(timestamp DESC, id DESC)`,
   * strictly after `page.cursor` when given.
   */
  list(filters: LogFilters, page: LogPageRequest): Promise<Log[]>;
}
