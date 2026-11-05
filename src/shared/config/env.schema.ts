import { z } from 'zod';
import { LLM_PROVIDERS, LOG_LEVELS, MAX_LLM_RETRIES } from './env.const.js';

export const EnvSchema = z
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
