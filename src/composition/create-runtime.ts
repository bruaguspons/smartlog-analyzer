import { createServer, type Server } from 'node:http';
import type { Express } from 'express';
import type { Logger } from 'pino';
import { createApp } from '@/app/create-app.js';
import { healthRepository } from '@/repositories/health.repository.js';
import { analysisRepository } from '@/repositories/analysis.repository.js';
import { serviceRepository } from '@/repositories/service.repository.js';
import { createApiRoutes } from '@/routes/api.routes.js';
import { analysisRunner, recoverInterrupted, type AnalysisRunner } from '@/services/analysis-runner.js';
import { analysisService } from '@/services/analysis.service.js';
import { logsService } from '@/services/logs.service.js';
import { config } from '@/shared/config/config.js';
import { prisma } from '@/shared/db/prisma.js';
import { logger } from '@/shared/logger.js';

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

/** Wires the application from the module singletons without listening or touching process-level state. */
export function createRuntime(): Runtime {
  const routes = createApiRoutes({
    logs: logsService,
    analysis: analysisService,
    checkDatabase: () => healthRepository.ping(),
    now: () => new Date(),
  });
  const app = createApp({ logger, serviceRepo: serviceRepository, routes });
  const server = createServer(app);
  const runner = analysisRunner;

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
      ['disconnect from the database', () => prisma.$disconnect()],
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
      await recoverInterrupted(analysisRepository, logger);
      await listen();
    },
    close() {
      closing ??= shutDown();
      return closing;
    },
  };
}
