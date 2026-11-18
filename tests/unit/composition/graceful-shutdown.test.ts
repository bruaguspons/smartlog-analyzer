import { describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdown, SHUTDOWN_DELAY_MS } from '@/composition/graceful-shutdown.js';

type Callback = (opts: { err?: Error; signal?: string }) => Promise<void>;

function setup(close: () => Promise<void> = () => Promise.resolve()) {
  const handle = { close: vi.fn(), uninstall: vi.fn() };
  const install = vi.fn<(opts: { delay: number; logger: unknown }, cb: Callback) => typeof handle>(() => handle);
  const runtime = { close: vi.fn(close), logger: { error: vi.fn(), info: vi.fn() } };
  const result = registerGracefulShutdown(runtime as never, install as never);
  const callback = install.mock.calls[0]?.[1] as Callback;
  return { runtime, install, callback, handle, result };
}

describe('registerGracefulShutdown', () => {
  it('installs with the forced-exit delay and the runtime logger, returning the handle', () => {
    const { runtime, install, handle, result } = setup();
    expect(SHUTDOWN_DELAY_MS).toBe(8000);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install.mock.calls[0]?.[0]).toEqual({ delay: 8000, logger: runtime.logger });
    expect(result).toBe(handle);
  });

  it('a signal is logged at info and closes the runtime once without logging an error', async () => {
    const { runtime, callback } = setup();
    await callback({ signal: 'SIGTERM' });
    expect(runtime.logger.info).toHaveBeenCalledWith({ signal: 'SIGTERM' }, expect.any(String));
    expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(runtime.logger.error).not.toHaveBeenCalled();
  });

  it('a fatal error is logged and the runtime is still closed', async () => {
    const { runtime, callback } = setup();
    const err = new Error('boom');
    await callback({ err });
    expect(runtime.logger.info).not.toHaveBeenCalled();
    expect(runtime.logger.error).toHaveBeenCalledWith({ err }, expect.any(String));
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });

  it('a close failure propagates', async () => {
    const { callback } = setup(() => Promise.reject(new Error('close failed')));
    await expect(callback({ signal: 'SIGINT' })).rejects.toThrow('close failed');
  });
});
