import type { Log } from '../domain/log.js';
import type { LogRepository } from '../domain/log-repository.js';

export class InMemoryLogRepository implements LogRepository {
  readonly logs: Log[] = [];

  create(log: Log): Promise<Log> {
    this.logs.push(log);
    return Promise.resolve(log);
  }
}
