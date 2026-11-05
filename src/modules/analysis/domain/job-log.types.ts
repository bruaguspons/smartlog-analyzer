/** Minimal logger the job needs; the request logger satisfies it, so job logs carry the `reqId`. */
export interface JobLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}
