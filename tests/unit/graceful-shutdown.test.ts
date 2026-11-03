import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  registerGracefulShutdown,
  type ShutdownTarget,
} from '../../src/shared/http/graceful-shutdown.js';

function setup(close: () => PromiseLike<unknown>) {
  const source = new EventEmitter();
  const exit = vi.fn();
  const closeFn = vi.fn(close);
  const log = { info: vi.fn(), error: vi.fn() };
  const app: ShutdownTarget = { close: closeFn, log };
  registerGracefulShutdown(app, { processLike: source, exit });
  return { source, exit, closeFn, log };
}

describe('registerGracefulShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('closes once then exits 0 on SIGTERM', async () => {
    const { source, exit, closeFn } = setup(() => Promise.resolve());
    source.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('ignores repeated signals while shutting down', async () => {
    const { source, exit, closeFn } = setup(() => Promise.resolve());
    source.emit('SIGINT', 'SIGINT');
    source.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('forces exit(1) when close never settles', async () => {
    const { source, exit } = setup(() => new Promise(() => undefined));
    source.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_TIMEOUT_MS);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('leaves no pending timer and never exits 1 on success', async () => {
    const { source, exit } = setup(() => Promise.resolve());
    source.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_TIMEOUT_MS * 2);
    expect(exit).not.toHaveBeenCalledWith(1);
  });

  it('logs and exits 1 when close rejects', async () => {
    const { source, exit, log } = setup(() => Promise.reject(new Error('boom')));
    source.emit('SIGTERM', 'SIGTERM');
    await vi.advanceTimersByTimeAsync(0);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(exit).not.toHaveBeenCalledWith(0);
  });

  it('honors custom signals', () => {
    const source = new EventEmitter();
    const exit = vi.fn();
    const app: ShutdownTarget = {
      close: () => Promise.resolve(),
      log: { info: vi.fn(), error: vi.fn() },
    };
    registerGracefulShutdown(app, { processLike: source, exit, signals: ['SIGUSR2'] });
    expect(source.listenerCount('SIGUSR2')).toBe(1);
    expect(source.listenerCount('SIGTERM')).toBe(0);
  });
});
