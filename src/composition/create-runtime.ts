import { randomUUIDv7 } from 'node:crypto';
import { buildApp } from '@/app/build-app.js';
import { createAnalysisRoutes } from '@/modules/analysis/http/create-analysis-routes.js';
import { createLogsRoutes } from '@/modules/logs/http/create-logs-routes.js';
import type { Config } from '@/shared/config/load-config.js';
import { AnalysisRunner, recoverInterrupted } from '@/services/analysis-runner.js';
import { AnalysisService } from '@/services/analysis.service.js';
import { LogsService } from '@/services/logs.service.js';
import type { Runtime, RuntimeDeps } from './runtime.types.js';

/** Wires the application from its dependencies without listening or touching process-level state. */
export function createRuntime(config: Config, deps: RuntimeDeps): Runtime {
  const newId = deps.newId ?? randomUUIDv7;
  const now = deps.now ?? (() => new Date());
  const { serviceRepo, logRepo, analysisRepo, llm } = deps;
  const runner = new AnalysisRunner({
    repo: analysisRepo,
    llm,
    policy: { timeoutMs: config.llm.timeoutMs, maxRetries: config.llm.maxRetries },
    now,
    ...(deps.retry && { retry: deps.retry }),
  });
  const logs = new LogsService({ logRepo, serviceRepo, newId });
  const analysis = new AnalysisService({ logs, analysisRepo, runner, llm, newId, now });
  const app = buildApp({
    serviceRepository: serviceRepo,
    checkDatabase: deps.checkDatabase,
    apiRoutes: [
      createLogsRoutes({ logs, now }),
      createAnalysisRoutes({ analysis }),
    ],
    logLevel: config.logLevel,
    ...(deps.logStream && { logStream: deps.logStream }),
  });
  // One root hook with an explicit order (not several plugin hooks relying on close order): in-flight analyses
  // are aborted and closed as INTERRUPTED while the pool is still open, and only then is the pool disconnected.
  app.addHook('onClose', async () => {
    try {
      await runner.shutdown();
    } catch (err) {
      app.log.error({ err }, 'failed to shut down the analysis runner');
    }
    try {
      await deps.disconnect();
    } catch (err) {
      app.log.error({ err }, 'failed to disconnect from the database');
    }
  });

  return {
    app,
    runner,
    async start() {
      // Before listening: leftover PROCESSING rows of a dead process would make every POST answer 409.
      await recoverInterrupted(analysisRepo, app.log);
      await app.listen({ port: config.port, host: config.host });
    },
  };
}
