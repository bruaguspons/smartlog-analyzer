import type { Config } from '@/shared/config/config.types.js';
import type { LlmClient } from '@/modules/analysis/domain/llm-client.types.js';
import { GeminiClient } from '@/modules/analysis/infrastructure/llm/gemini/gemini-client.js';
import { MockClient } from '@/modules/analysis/infrastructure/llm/mock/mock-client.js';

/** Picks the adapter by `LLM_PROVIDER`. Config validation already guarantees the key; this is a guard. */
export function createLlmClient(llm: Config['llm']): LlmClient {
  if (llm.provider === 'gemini') {
    if (!llm.apiKey) throw new Error('GEMINI_API_KEY is required when LLM_PROVIDER=gemini');
    return new GeminiClient({ apiKey: llm.apiKey, model: llm.model });
  }
  return new MockClient();
}
