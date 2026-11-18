import { randomUUIDv7 } from 'node:crypto';
import pino from 'pino';
import { createApp } from '@/app/create-app.js';
import type { RuntimeDeps } from '@/composition/runtime.types.js';
import { createApiRoutes } from '@/routes/api.routes.js';
import { AnalysisRunner } from '@/services/analysis-runner.js';
import { AnalysisService } from '@/services/analysis.service.js';
import { LogsService } from '@/services/logs.service.js';
import type { Config } from '@/shared/config/load-config.js';

/** Same wiring as the runtime (runner, services, route table), without listening. */
export function buildExpressApp(config: Config, deps: RuntimeDeps, logStream?: { write(msg: string): void }) {
  const newId = deps.newId ?? randomUUIDv7;
  const now = deps.now ?? (() => new Date());
  const { serviceRepo, logRepo, analysisRepo, llm } = deps;
  const logger = pino({ level: logStream ? 'info' : 'silent', redact: ['req.headers["x-api-key"]'] }, logStream);
  const runner = new AnalysisRunner({
    repo: analysisRepo,
    llm,
    policy: { timeoutMs: config.llm.timeoutMs, maxRetries: config.llm.maxRetries },
    now,
    ...(deps.retry && { retry: deps.retry }),
  });
  const logs = new LogsService({ logRepo, serviceRepo, newId });
  const analysis = new AnalysisService({ logs, analysisRepo, runner, llm, newId, now });
  const routes = createApiRoutes({ logs, analysis, checkDatabase: deps.checkDatabase, now });
  const app = createApp({ logger, serviceRepo, routes });
  return { app, runner, logger };
}
