import type { RetryDeps } from './retry.types.js';

export const defaultRetryDeps: RetryDeps = {
  random: Math.random,
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason as Error);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};
