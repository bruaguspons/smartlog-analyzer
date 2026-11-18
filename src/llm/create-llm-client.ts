import type { Config } from '@/shared/config/load-config.js';
import { GeminiClient } from './gemini-client.js';
import type { LlmClient } from './llm-client.js';
import { MockClient } from './mock-client.js';

/** Picks the adapter by `LLM_PROVIDER`. Config validation already guarantees the key; this is a guard. */
export function createLlmClient(llm: Config['llm']): LlmClient {
  if (llm.provider === 'gemini') {
    if (!llm.apiKey) throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
    return new GeminiClient({ apiKey: llm.apiKey, model: llm.model });
  }
  return new MockClient({ behavior: llm.mockBehavior });
}
