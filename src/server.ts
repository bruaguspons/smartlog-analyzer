import { buildApp } from './app.js';
import { InMemoryServiceRepository } from './modules/services/infrastructure/in-memory-service-repository.js';
import { ConfigError, loadConfig, type Config } from './shared/config/env.js';
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

// TEMPORARY: empty repo, all protected routes return 401 until the Prisma repository change.
const app = buildApp({ serviceRepository: new InMemoryServiceRepository(), logLevel: config.logLevel });
registerGracefulShutdown(app);

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
