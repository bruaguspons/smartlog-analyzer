import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const EnvSchema = z.object({
  // An empty string coerces to 0 and is rejected by min(1).
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export interface Config {
  port: number;
  host: string;
  logLevel: LogLevel;
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
  const { PORT, HOST, LOG_LEVEL } = result.data;
  return { port: PORT, host: HOST, logLevel: LOG_LEVEL };
}
