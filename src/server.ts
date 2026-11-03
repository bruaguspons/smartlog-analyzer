import { buildApp } from './app.js';
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
const app = buildApp({ serviceRepository: new PrismaServiceRepository(prisma), logLevel: config.logLevel });
// app.close() runs onClose hooks, so graceful shutdown disconnects the pool without touching the shutdown module.
app.addHook('onClose', async () => {
  try {
    await prisma.$disconnect();
  } catch (err) {
    app.log.error({ err }, 'failed to disconnect Prisma');
  }
});
registerGracefulShutdown(app);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
