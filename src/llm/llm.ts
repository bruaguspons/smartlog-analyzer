import { config } from '@/shared/config/config.js';
import { createLlmClient } from './create-llm-client.js';

/** The client chosen by `LLM_PROVIDER` at startup; tests replace this module to script the model. */
export const llmClient = createLlmClient(config.llm);
