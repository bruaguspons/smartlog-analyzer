import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/shared/config/env.js';

describe('loadConfig', () => {
  it('applies defaults for an empty env', () => {
    expect(loadConfig({})).toEqual({ port: 3000, host: '0.0.0.0', logLevel: 'info' });
  });

  it('coerces PORT to a number', () => {
    expect(loadConfig({ PORT: '4000' }).port).toBe(4000);
  });

  it('reads HOST and LOG_LEVEL', () => {
    const config = loadConfig({ HOST: '127.0.0.1', LOG_LEVEL: 'debug' });
    expect(config.host).toBe('127.0.0.1');
    expect(config.logLevel).toBe('debug');
  });

  it.each(['abc', '0', '65536', '-1', '3000.5', ''])('rejects PORT=%j', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/PORT/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it('throws a typed ConfigError', () => {
    try {
      loadConfig({ PORT: 'abc' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).name).toBe('ConfigError');
    }
  });
});
