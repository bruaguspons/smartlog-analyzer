import { ScriptedLlmClient } from './scripted-llm-client.js';

/**
 * Replacement for the `@/llm/llm.js` module, used as its mock factory:
 * `vi.mock('@/llm/llm.js', async () => (await import('@tests/support/fakes/scripted-llm-module.js')).scriptedLlmModule())`.
 * It lives apart from `scriptedLlm()` because that accessor imports the mocked module itself.
 */
export function scriptedLlmModule(): { llmClient: ScriptedLlmClient } {
  return { llmClient: new ScriptedLlmClient() };
}
