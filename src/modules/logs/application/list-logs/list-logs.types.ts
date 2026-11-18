import type { Log, LogCursor, LogFilters } from '@/models/log.js';
import type { LogRepository } from '@/repositories/log.repository.js';

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
