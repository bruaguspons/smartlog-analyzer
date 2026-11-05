import type { LogLevel } from '@/modules/logs/domain/log.types.js';
import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';
import type { ServiceRepository } from '@/modules/services/domain/service-repository.types.js';

export interface LogStatsGroup {
  service: { id: number; name: string };
  level: LogLevel;
  count: number;
}

export interface LogStats {
  total: number;
  groups: LogStatsGroup[];
}

export interface GetLogStatsDeps {
  repo: LogRepository;
  serviceRepo: ServiceRepository;
}
