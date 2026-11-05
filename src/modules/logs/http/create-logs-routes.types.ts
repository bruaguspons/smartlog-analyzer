import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';
import type { ServiceRepository } from '@/modules/services/domain/service-repository.types.js';

export interface LogsRoutesDeps {
  repo: LogRepository;
  serviceRepo: ServiceRepository;
  newId: () => string;
  now: () => Date;
}
