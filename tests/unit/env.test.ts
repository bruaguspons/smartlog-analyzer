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
      llm: { provider: 'mock', model: 'gemini-3.6-flash', timeoutMs: 30000, maxRetries: 3 },
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

describe('loadConfig LLM settings', () => {
  it('S36: gemini with an API key exposes it', () => {
    const { llm } = loadConfig({ ...BASE, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' });
    expect(llm).toEqual({
      provider: 'gemini',
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      timeoutMs: 30000,
      maxRetries: 3,
    });
  });

  it.each([undefined, ''])('S36: gemini without GEMINI_API_KEY=%j fails naming it', (key) => {
    const env = { ...BASE, LLM_PROVIDER: 'gemini', ...(key !== undefined && { GEMINI_API_KEY: key }) };
    expect(() => loadConfig(env)).toThrow(/GEMINI_API_KEY/);
  });

  it('does not require a key for the mock provider', () => {
    expect(loadConfig({ ...BASE, LLM_PROVIDER: 'mock' }).llm.apiKey).toBeUndefined();
  });

  it('S37: rejects an unknown LLM_PROVIDER', () => {
    expect(() => loadConfig({ ...BASE, LLM_PROVIDER: 'openai' })).toThrow(/LLM_PROVIDER/);
  });

  it('reads LLM_MODEL', () => {
    expect(loadConfig({ ...BASE, LLM_MODEL: 'other-model' }).llm.model).toBe('other-model');
  });

  it('S38: coerces LLM_TIMEOUT_MS to a number', () => {
    expect(loadConfig({ ...BASE, LLM_TIMEOUT_MS: '1500' }).llm.timeoutMs).toBe(1500);
  });

  it.each(['0', 'abc', '-5', '1.5', ''])('S38: rejects LLM_TIMEOUT_MS=%j', (value) => {
    expect(() => loadConfig({ ...BASE, LLM_TIMEOUT_MS: value })).toThrow(/LLM_TIMEOUT_MS/);
  });

  it.each([
    ['0', 0],
    ['10', 10],
    ['5', 5],
  ])('S39: accepts LLM_MAX_RETRIES=%j', (value, expected) => {
    expect(loadConfig({ ...BASE, LLM_MAX_RETRIES: value }).llm.maxRetries).toBe(expected);
  });

  it.each(['-1', '11', 'abc', '1.5', ''])('S39: rejects LLM_MAX_RETRIES=%j', (value) => {
    expect(() => loadConfig({ ...BASE, LLM_MAX_RETRIES: value })).toThrow(/LLM_MAX_RETRIES/);
  });
});
