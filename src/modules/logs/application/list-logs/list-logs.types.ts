import type { LogCursor, LogFilters } from '@/modules/logs/domain/log-filters.types.js';
import type { Log } from '@/modules/logs/domain/log.types.js';
import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';

export interface ListLogsQuery {
  filters: LogFilters;
  limit: number;
  cursor?: LogCursor | undefined;
}

export interface LogPage {
  items: Log[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ListLogsDeps {
  repo: LogRepository;
}
