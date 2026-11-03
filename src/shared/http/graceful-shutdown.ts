import type { FastifyBaseLogger } from 'fastify';

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 8000; // below Docker's 10 s stop grace

export interface ShutdownTarget {
  close(): PromiseLike<unknown>;
  log: Pick<FastifyBaseLogger, 'info' | 'error'>;
}

export interface SignalSource {
  on(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
}

export interface GracefulShutdownOptions {
  signals?: readonly NodeJS.Signals[];
  timeoutMs?: number;
  processLike?: SignalSource;
  exit?: (code: number) => void;
}

/**
 * Closes the app on the given signals, then exits 0. Once-only: repeated signals
 * are ignored while shutting down. An unref'd timer forces exit(1) if close hangs.
 */
export function registerGracefulShutdown(
  app: ShutdownTarget,
  options: GracefulShutdownOptions = {},
): (signal: NodeJS.Signals) => Promise<void> {
  const {
    signals = ['SIGINT', 'SIGTERM'],
    timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    processLike = process,
    exit = (code: number) => process.exit(code),
  } = options;

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutdown signal received, closing server');
    const timer = setTimeout(() => {
      exit(1);
    }, timeoutMs);
    timer.unref();
    try {
      await app.close();
      clearTimeout(timer);
      exit(0);
    } catch (err) {
      app.log.error({ err }, 'error while closing server');
      clearTimeout(timer);
      exit(1);
    }
  };

  for (const signal of signals) {
    processLike.on(signal, (s) => {
      void shutdown(s);
    });
  }

  return shutdown;
}
