import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/shared/config/env.js';

const BASE = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults when only DATABASE_URL is set', () => {
    expect(loadConfig(BASE)).toEqual({
      port: 3000,
      host: '0.0.0.0',
      logLevel: 'info',
      databaseUrl: BASE.DATABASE_URL,
      seedOnStart: true,
    });
  });

  it('coerces PORT to a number', () => {
    expect(loadConfig({ ...BASE, PORT: '4000' }).port).toBe(4000);
  });

  it('reads HOST and LOG_LEVEL', () => {
    const config = loadConfig({ ...BASE, HOST: '127.0.0.1', LOG_LEVEL: 'debug' });
    expect(config.host).toBe('127.0.0.1');
    expect(config.logLevel).toBe('debug');
  });

  it.each(['abc', '0', '65536', '-1', '3000.5', ''])('rejects PORT=%j', (port) => {
    expect(() => loadConfig({ ...BASE, PORT: port })).toThrow(/PORT/);
  });

  it('rejects an unknown LOG_LEVEL', () => {
    expect(() => loadConfig({ ...BASE, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
  });

  it.each([undefined, '', 'not-a-url', 'mysql://u:p@localhost/db'])('rejects DATABASE_URL=%j', (url) => {
    expect(() => loadConfig(url === undefined ? {} : { DATABASE_URL: url })).toThrow(/DATABASE_URL/);
  });

  it('defaults SEED_ON_START to true', () => {
    expect(loadConfig(BASE).seedOnStart).toBe(true);
  });

  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('parses SEED_ON_START=%j', (value, expected) => {
    expect(loadConfig({ ...BASE, SEED_ON_START: value }).seedOnStart).toBe(expected);
  });

  it('rejects an invalid SEED_ON_START', () => {
    expect(() => loadConfig({ ...BASE, SEED_ON_START: 'maybe' })).toThrow(/SEED_ON_START/);
  });

  it('throws a typed ConfigError', () => {
    try {
      loadConfig({ ...BASE, PORT: 'abc' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).name).toBe('ConfigError');
    }
  });
});
