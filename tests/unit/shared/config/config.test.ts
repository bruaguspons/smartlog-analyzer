import { afterEach, describe, expect, it, vi } from 'vitest';

const VALID_URL = 'postgresql://u:p@localhost:5432/db';

/** The module validates when it is imported, so every case needs a fresh import. */
async function importConfig() {
  vi.resetModules();
  return import('@/shared/config/config.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('config', () => {
  it('exposes the validated environment', async () => {
    vi.stubEnv('DATABASE_URL', VALID_URL);
    vi.stubEnv('PORT', '4010');

    const { config } = await importConfig();

    expect(config).toMatchObject({ databaseUrl: VALID_URL, port: 4010, llm: { provider: 'mock' } });
  });

  it('reports invalid configuration and exits with code 1', async () => {
    vi.stubEnv('DATABASE_URL', VALID_URL);
    vi.stubEnv('LLM_PROVIDER', 'gemini');
    vi.stubEnv('GEMINI_API_KEY', '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit called');
    });

    await expect(importConfig()).rejects.toThrow('exit called');

    expect(error).toHaveBeenCalledWith(expect.stringContaining('GEMINI_API_KEY'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits when DATABASE_URL is empty, which is what the unit project sets', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit called');
    });

    await expect(importConfig()).rejects.toThrow('exit called');
  });
});
