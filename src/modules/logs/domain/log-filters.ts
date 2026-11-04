import type { LogLevel } from './log.js';

/** Optional filters shared by listing, stats and analysis; all provided ones combine with AND. */
export interface LogFilters {
  serviceId?: number | undefined;
  /** Matches ANY listed level. */
  level?: readonly LogLevel[] | undefined;
  /** Inclusive lower bound. */
  from?: Date | undefined;
  /** Inclusive upper bound. */
  to?: Date | undefined;
  /** Exact, case-sensitive match. */
  traceId?: string | undefined;
  /** Case-insensitive literal substring of `message`. */
  search?: string | undefined;
}

/** Position of the last returned log in `(timestamp DESC, id DESC)` order. */
export interface LogCursor {
  timestamp: Date;
  id: string;
}

export interface LogPageRequest {
  take: number;
  /** Exclusive: the page starts strictly after this position. */
  cursor?: LogCursor | undefined;
}
