import type { Log } from './log.js';

export interface LogRepository {
  create(log: Log): Promise<Log>;
}
