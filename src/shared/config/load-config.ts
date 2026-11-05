import { ConfigError } from './config-error.js';
import type { Config } from './config.types.js';
import { EnvSchema } from './env.schema.js';

/** Parses and validates environment variables. Throws `ConfigError` when invalid. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error);
  }
  const parsed = result.data;
  return {
    port: parsed.PORT,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    seedOnStart: parsed.SEED_ON_START,
    llm: {
      provider: parsed.LLM_PROVIDER,
      ...(parsed.GEMINI_API_KEY && { apiKey: parsed.GEMINI_API_KEY }),
      model: parsed.LLM_MODEL,
      timeoutMs: parsed.LLM_TIMEOUT_MS,
      maxRetries: parsed.LLM_MAX_RETRIES,
    },
  };
}
