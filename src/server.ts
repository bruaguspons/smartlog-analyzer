import { createServer } from 'node:http';
import closeWithGrace from 'close-with-grace';
import { app } from '@/app.js';
import { analysisRepository } from '@/repositories/analysis.repository.js';
import { analysisRunner, recoverInterrupted } from '@/services/analysis-runner.js';
import { config } from '@/shared/config/config.js';
import { prisma } from '@/shared/db/prisma.js';
import { logger } from '@/shared/logger.js';

const server = createServer(app);

// Forced exit after this delay; it stays below Docker's 10 s stop grace period.
closeWithGrace({ delay: 8000, logger }, async ({ err, signal }) => {
  // close-with-grace only logs the second signal, so the first one is logged here.
  if (signal) logger.info({ signal }, 'signal received, closing server');
  if (err) logger.error({ err }, 'fatal error, closing server');

  // Fixed order, each step isolated so a failure never skips the next one: no new requests, then in-flight
  // analyses are aborted and closed as INTERRUPTED while the pool is still open, and only then the pool goes.
  try {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    logger.info('http server stopped');
  } catch (e) {
    logger.error({ err: e }, 'failed to stop the http server');
  }
  try {
    await analysisRunner.shutdown();
    logger.info('analysis runner stopped');
  } catch (e) {
    logger.error({ err: e }, 'failed to shut down the analysis runner');
  }
  try {
    await prisma.$disconnect();
    logger.info('database disconnected');
  } catch (e) {
    logger.error({ err: e }, 'failed to disconnect from the database');
  }
});

try {
  // Before listening: leftover PROCESSING rows of a dead process would make every POST answer 409.
  await recoverInterrupted(analysisRepository, logger);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  logger.info({ port: config.port, host: config.host }, 'server listening');
} catch (err) {
  logger.error({ err }, 'startup failed');
  process.exit(1);
}
