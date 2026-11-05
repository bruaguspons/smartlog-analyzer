import { describe, expect, it } from 'vitest';
import { createLlmClient } from '@/modules/analysis/infrastructure/llm/create-llm-client.js';
import { GeminiClient } from '@/modules/analysis/infrastructure/llm/gemini/gemini-client.js';
import { MockClient } from '@/modules/analysis/infrastructure/llm/mock/mock-client.js';
import type { Config } from '@/shared/config/config.types.js';

const llm = (overrides: Partial<Config['llm']> = {}): Config['llm'] => ({
  provider: 'mock',
  model: 'gemini-3.6-flash',
  timeoutMs: 30_000,
  maxRetries: 3,
  ...overrides,
});

describe('createLlmClient', () => {
  it('returns the mock client for the mock provider', () => {
    expect(createLlmClient(llm())).toBeInstanceOf(MockClient);
  });

  it('returns a Gemini client with the configured model when provider is gemini', () => {
    const client = createLlmClient(llm({ provider: 'gemini', apiKey: 'test-key', model: 'gemini-x' }));
    expect(client).toBeInstanceOf(GeminiClient);
    expect(client.model).toBe('gemini-x');
  });

  it('refuses gemini without an API key', () => {
    expect(() => createLlmClient(llm({ provider: 'gemini' }))).toThrow(/GEMINI_API_KEY/);
  });
});
