import type { LogLevel } from '@/models/log.js';
import type { LogRepository } from '@/repositories/log.repository.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';

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
