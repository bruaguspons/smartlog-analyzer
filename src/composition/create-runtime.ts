import { randomUUIDv7 } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { Express } from 'express';
import pino, { type Logger } from 'pino';
import { createApp } from '@/app/create-app.js';
import type { DatabaseCheck } from '@/controllers/health.controller.js';
import type { RetryDeps } from '@/llm/call-with-retry.js';
import type { LlmClient } from '@/llm/llm-client.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';
import type { LogRepository } from '@/repositories/log.repository.js';
import type { ServiceRepository } from '@/repositories/service.repository.js';
import { createApiRoutes } from '@/routes/api.routes.js';
import { AnalysisRunner, recoverInterrupted } from '@/services/analysis-runner.js';
import { AnalysisService } from '@/services/analysis.service.js';
import { LogsService } from '@/services/logs.service.js';
import type { Config } from '@/shared/config/load-config.js';

/** Everything the runtime needs from the outside world; tests inject Prisma repositories over a test database and a scripted LLM. */
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
  app: Express;
  server: Server;
  runner: AnalysisRunner;
  logger: Logger;
  /** Recovers leftover PROCESSING rows, then listens (in that order). */
  start(): Promise<void>;
  /** Stops accepting connections, closes in-flight analyses, then releases the database. Safe to call twice. */
  close(): Promise<void>;
}

/** Wires the application from its dependencies without listening or touching process-level state. */
export function createRuntime(config: Config, deps: RuntimeDeps): Runtime {
  const newId = deps.newId ?? randomUUIDv7;
  const now = deps.now ?? (() => new Date());
  const { serviceRepo, logRepo, analysisRepo, llm } = deps;
  const logger = pino({ level: config.logLevel, redact: ['req.headers["x-api-key"]'] }, deps.logStream);
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
  const server = createServer(app);

  function listen(): Promise<void> {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
  }

  function stopListening(): Promise<void> {
    if (!server.listening) return Promise.resolve();
    return new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // Fixed order, each step isolated so a failure never skips the next one: no new requests, then in-flight
  // analyses are aborted and closed as INTERRUPTED while the pool is still open, and only then the pool goes.
  async function shutDown(): Promise<void> {
    const steps: [string, () => Promise<void>][] = [
      ['stop the HTTP server', stopListening],
      ['shut down the analysis runner', () => runner.shutdown()],
      ['disconnect from the database', deps.disconnect],
    ];
    for (const [label, step] of steps) {
      try {
        await step();
      } catch (err) {
        logger.error({ err }, `failed to ${label}`);
      }
    }
  }

  let closing: Promise<void> | undefined;

  return {
    app,
    server,
    runner,
    logger,
    async start() {
      // Before listening: leftover PROCESSING rows of a dead process would make every POST answer 409.
      await recoverInterrupted(analysisRepo, logger);
      await listen();
    },
    close() {
      closing ??= shutDown();
      return closing;
    },
  };
}
