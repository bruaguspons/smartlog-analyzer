import type { FastifyInstance } from 'fastify';
import closeWithGrace from 'close-with-grace';
import { SHUTDOWN_DELAY_MS } from './graceful-shutdown.const.js';

/**
 * Thin wrapper over close-with-grace, which owns signals, uncaught errors and the
 * forced exit. `install` is injectable so tests need no real signals.
 */
export function registerGracefulShutdown(
  app: Pick<FastifyInstance, 'close' | 'log'>,
  install: typeof closeWithGrace = closeWithGrace,
): ReturnType<typeof closeWithGrace> {
  return install({ delay: SHUTDOWN_DELAY_MS, logger: app.log }, async ({ err, signal }) => {
    // close-with-grace only logs the second signal, so the first one is logged here.
    if (signal) app.log.info({ signal }, 'signal received, closing server');
    if (err) app.log.error({ err }, 'fatal error, closing server');
    await app.close();
  });
}
