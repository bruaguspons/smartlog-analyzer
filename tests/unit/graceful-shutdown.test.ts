import { describe, expect, it, vi } from 'vitest';
import { registerGracefulShutdown, SHUTDOWN_DELAY_MS } from '../../src/shared/http/graceful-shutdown.js';

type Callback = (opts: { err?: Error; signal?: string }) => Promise<void>;

function setup(close: () => Promise<void> = () => Promise.resolve()) {
  const handle = { close: vi.fn(), uninstall: vi.fn() };
  const install = vi.fn<(opts: { delay: number; logger: unknown }, cb: Callback) => typeof handle>(() => handle);
  const app = { close: vi.fn(close), log: { error: vi.fn(), info: vi.fn() } };
  const result = registerGracefulShutdown(app as never, install as never);
  const callback = install.mock.calls[0]?.[1] as Callback;
  return { app, install, callback, handle, result };
}

describe('registerGracefulShutdown', () => {
  it('installs with the forced-exit delay and the app logger, returning the handle', () => {
    const { app, install, handle, result } = setup();
    expect(SHUTDOWN_DELAY_MS).toBe(8000);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install.mock.calls[0]?.[0]).toEqual({ delay: 8000, logger: app.log });
    expect(result).toBe(handle);
  });

  it('S-PL-1: a signal is logged at info and closes the app once without logging an error', async () => {
    const { app, callback } = setup();
    await callback({ signal: 'SIGTERM' });
    expect(app.log.info).toHaveBeenCalledWith({ signal: 'SIGTERM' }, expect.any(String));
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(app.log.error).not.toHaveBeenCalled();
  });

  it('S-PL-2: a fatal error is logged and the app is still closed', async () => {
    const { app, callback } = setup();
    const err = new Error('boom');
    await callback({ err });
    expect(app.log.info).not.toHaveBeenCalled();
    expect(app.log.error).toHaveBeenCalledWith({ err }, expect.any(String));
    expect(app.close).toHaveBeenCalledTimes(1);
  });

  it('S-PL-3: a close failure propagates', async () => {
    const { callback } = setup(() => Promise.reject(new Error('close failed')));
    await expect(callback({ signal: 'SIGINT' })).rejects.toThrow('close failed');
  });
});
