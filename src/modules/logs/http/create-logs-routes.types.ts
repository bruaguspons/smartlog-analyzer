import type { LogsService } from '@/services/logs.service.js';

export interface LogsRoutesDeps {
  logs: LogsService;
  now: () => Date;
}
