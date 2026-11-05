import type { LOG_LEVELS } from './log.const.js';

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
