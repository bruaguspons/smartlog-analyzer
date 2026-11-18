import { llmClient } from '@/llm/llm.js';
import { ScriptedLlmClient } from './scripted-llm-client.js';

/** The client that `vi.mock('@/llm/llm.js', ...)` with `scriptedLlmModule` put in place of the configured one. */
export function scriptedLlm(): ScriptedLlmClient {
  if (!(llmClient instanceof ScriptedLlmClient)) {
    throw new Error("scriptedLlm() needs vi.mock('@/llm/llm.js', ...) with scriptedLlmModule in this test file");
  }
  return llmClient;
}
