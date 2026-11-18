import type { LogRepository } from '@/repositories/log.repository.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';

export interface LogsRoutesDeps {
  repo: LogRepository;
  serviceRepo: ServiceRepository;
  newId: () => string;
  now: () => Date;
}
