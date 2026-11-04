import { randomUUIDv7 } from 'node:crypto';
import { buildApp } from './app.js';
import { AnalysisRunner } from './modules/analysis/application/analysis-runner.js';
import { recoverInterrupted } from './modules/analysis/application/recover-interrupted.js';
import { createAnalysisRoutes } from './modules/analysis/http/analysis-routes.js';
import { createLlmClient } from './modules/analysis/infrastructure/llm/create-llm-client.js';
import { PrismaAnalysisRepository } from './modules/analysis/infrastructure/prisma-analysis-repository.js';
import { createLogsRoutes } from './modules/logs/http/logs-routes.js';
import { PrismaLogRepository } from './modules/logs/infrastructure/prisma-log-repository.js';
import { PrismaServiceRepository } from './modules/services/infrastructure/prisma-service-repository.js';
import { ConfigError, loadConfig, type Config } from './shared/config/env.js';
import { createPrismaClient } from './shared/db/prisma-client.js';
import { registerGracefulShutdown } from './shared/http/graceful-shutdown.js';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

const prisma = createPrismaClient(config.databaseUrl);
const logRepo = new PrismaLogRepository(prisma);
const analysisRepo = new PrismaAnalysisRepository(prisma);
const llm = createLlmClient(config.llm);
const runner = new AnalysisRunner({
  repo: analysisRepo,
  llm,
  policy: { timeoutMs: config.llm.timeoutMs, maxRetries: config.llm.maxRetries },
  now: () => new Date(),
});
const serviceRepo = new PrismaServiceRepository(prisma);
const app = buildApp({
  serviceRepository: serviceRepo,
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  apiRoutes: [
    createLogsRoutes({ repo: logRepo, serviceRepo, newId: randomUUIDv7, now: () => new Date() }),
    createAnalysisRoutes({ logRepo, analysisRepo, runner, llm, newId: randomUUIDv7, now: () => new Date() }),
  ],
  logLevel: config.logLevel,
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
    await prisma.$disconnect();
  } catch (err) {
    app.log.error({ err }, 'failed to disconnect Prisma');
  }
});
registerGracefulShutdown(app);

try {
  // Before listening: leftover PROCESSING rows of a dead process would make every POST answer 409 (D15).
  await recoverInterrupted(analysisRepo, app.log);
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
