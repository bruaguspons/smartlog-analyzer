export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'] as const;

export const MAX_TRACE_ID_LENGTH = 128;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Log {
  /** UUIDv7, assigned by the server; it also encodes the reception time. */
  id: string;
  serviceId: number;
  level: LogLevel;
  timestamp: Date;
  message: string;
  traceId: string | null;
  metadata: JsonObject | null;
}

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
