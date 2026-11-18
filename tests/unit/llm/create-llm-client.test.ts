import { describe, expect, it } from 'vitest';
import { createLlmClient } from '@/llm/create-llm-client.js';
import { GeminiClient } from '@/llm/gemini-client.js';
import { MockClient } from '@/llm/mock-client.js';
import type { Config } from '@/shared/config/load-config.js';

const llm = (overrides: Partial<Config['llm']> = {}): Config['llm'] => ({
  provider: 'mock',
  model: 'gemini-3.6-flash',
  timeoutMs: 30_000,
  maxRetries: 3,
  mockBehavior: 'normal',
  ...overrides,
});

describe('createLlmClient', () => {
  it('returns the mock client for the mock provider', () => {
    expect(createLlmClient(llm())).toBeInstanceOf(MockClient);
  });

  it('passes the configured mock behavior to the mock client', async () => {
    const client = createLlmClient(llm({ mockBehavior: 'invalid' }));
    const result = await client.generate({ systemInstruction: '', prompt: '', entries: [] }, new AbortController().signal);
    expect(() => {
      JSON.parse(result.text) as unknown;
    }).toThrow();
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
