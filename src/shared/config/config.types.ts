import type { LLM_PROVIDERS, LOG_LEVELS } from './env.const.js';

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface Config {
  port: number;
  host: string;
  logLevel: LogLevel;
  databaseUrl: string;
  seedOnStart: boolean;
  llm: {
    provider: LlmProvider;
    /** Present only when configured; required for `gemini`. */
    apiKey?: string | undefined;
    model: string;
    /** Per-attempt timeout. */
    timeoutMs: number;
    /** Retries after the first attempt (0..10). */
    maxRetries: number;
  };
}
