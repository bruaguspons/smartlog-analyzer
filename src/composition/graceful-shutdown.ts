import closeWithGrace from 'close-with-grace';
import type { Runtime } from './create-runtime.js';

/** Forced-exit timeout; stays below Docker's 10 s stop grace period. */
export const SHUTDOWN_DELAY_MS = 8000;

/**
 * Thin wrapper over close-with-grace, which owns signals, uncaught errors and the
 * forced exit. `install` is injectable so tests need no real signals.
 */
export function registerGracefulShutdown(
  runtime: Pick<Runtime, 'close' | 'logger'>,
  install: typeof closeWithGrace = closeWithGrace,
): ReturnType<typeof closeWithGrace> {
  return install({ delay: SHUTDOWN_DELAY_MS, logger: runtime.logger }, async ({ err, signal }) => {
    // close-with-grace only logs the second signal, so the first one is logged here.
    if (signal) runtime.logger.info({ signal }, 'signal received, closing server');
    if (err) runtime.logger.error({ err }, 'fatal error, closing server');
    await runtime.close();
  });
}
