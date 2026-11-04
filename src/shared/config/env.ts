import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LLM_PROVIDERS = ['mock', 'gemini'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const MAX_LLM_RETRIES = 10;

const EnvSchema = z
  .object({
  // An empty string coerces to 0 and is rejected by min(1).
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    SEED_ON_START: z.stringbool().default(true),
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('mock'),
    // Empty is allowed so compose can pass `${GEMINI_API_KEY:-}`; it is treated as unset.
    GEMINI_API_KEY: z.string().optional(),
    LLM_MODEL: z.string().min(1).default('gemini-3.6-flash'),
    // Per-attempt timeout. An empty string coerces to 0 and is rejected by min(1).
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1).default(30_000),
    // Retries after the first attempt; 0 means a single attempt. The regex rejects '' (which would coerce to 0).
    LLM_MAX_RETRIES: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().max(MAX_LLM_RETRIES))
      .default(3),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['GEMINI_API_KEY'], message: 'GEMINI_API_KEY is required when LLM_PROVIDER=gemini' });
    }
  });

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

export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(error: z.ZodError) {
    super(`Invalid environment configuration:\n${z.prettifyError(error)}`, { cause: error });
  }
}

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
