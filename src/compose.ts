import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { AnalysisRunner } from './modules/analysis/application/analysis-runner.js';
import type { RetryDeps } from './modules/analysis/application/retry-policy.js';
import { recoverInterrupted } from './modules/analysis/application/recover-interrupted.js';
import type { AnalysisRepository } from './modules/analysis/domain/analysis-repository.js';
import type { LlmClient } from './modules/analysis/domain/llm-client.js';
import { createAnalysisRoutes } from './modules/analysis/http/analysis-routes.js';
import { createLlmClient } from './modules/analysis/infrastructure/llm/create-llm-client.js';
import { PrismaAnalysisRepository } from './modules/analysis/infrastructure/prisma-analysis-repository.js';
import type { LogRepository } from './modules/logs/domain/log-repository.js';
import { createLogsRoutes } from './modules/logs/http/logs-routes.js';
import { PrismaLogRepository } from './modules/logs/infrastructure/prisma-log-repository.js';
import type { ServiceRepository } from './modules/services/domain/service-repository.js';
import { PrismaServiceRepository } from './modules/services/infrastructure/prisma-service-repository.js';
import { ConfigError, loadConfig, type Config } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma-client.js';
import { registerGracefulShutdown } from './shared/http/graceful-shutdown.js';
import type { DatabaseCheck } from './shared/http/health-route.js';

/** Everything the runtime needs from the outside world; tests inject in-memory fakes. */
export interface RuntimeDeps {
  serviceRepo: ServiceRepository;
  logRepo: LogRepository;
  analysisRepo: AnalysisRepository;
  llm: LlmClient;
  checkDatabase: DatabaseCheck;
  /** Releases the database pool; always runs after the analysis runner has shut down. */
  disconnect: () => Promise<void>;
  retry?: Partial<RetryDeps>;
  newId?: () => string;
  now?: () => Date;
  logStream?: { write(msg: string): void };
}

export interface Runtime {
  app: FastifyInstance;
  runner: AnalysisRunner;
  /** Recovers leftover PROCESSING rows, then listens (in that order). */
  start(): Promise<void>;
}

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
  const app = buildApp({
    serviceRepository: serviceRepo,
    checkDatabase: deps.checkDatabase,
    apiRoutes: [
      createLogsRoutes({ repo: logRepo, serviceRepo, newId, now }),
      createAnalysisRoutes({ logRepo, analysisRepo, runner, llm, newId, now }),
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

/** Production dependencies: Prisma repositories and the configured LLM client. */
export function createPrismaDeps(config: Config): RuntimeDeps {
  const prisma = createPrismaClient(config.databaseUrl);
  return {
    serviceRepo: new PrismaServiceRepository(prisma),
    logRepo: new PrismaLogRepository(prisma),
    analysisRepo: new PrismaAnalysisRepository(prisma),
    llm: createLlmClient(config.llm),
    checkDatabase: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    disconnect: () => prisma.$disconnect(),
  };
}

/** Process-level effects of `main`, injectable so failures can be tested without exiting. */
export interface ProcessIo {
  exit(code: number): void;
  error(message: string): void;
  registerShutdown(app: FastifyInstance): void;
}

const defaultIo: ProcessIo = {
  exit: (code) => process.exit(code),
  error: (message) => {
    console.error(message);
  },
  registerShutdown: (app) => {
    registerGracefulShutdown(app);
  },
};

/** Entry point: invalid config or a failed startup is reported and ends in exit code 1. */
export async function main(
  env: NodeJS.ProcessEnv,
  io: ProcessIo = defaultIo,
  makeDeps: (config: Config) => RuntimeDeps = createPrismaDeps,
): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      io.error(err.message);
      io.exit(1);
      return;
    }
    throw err;
  }

  const runtime = createRuntime(config, makeDeps(config));
  io.registerShutdown(runtime.app);
  try {
    await runtime.start();
  } catch (err) {
    runtime.app.log.error(err);
    io.exit(1);
  }
}
