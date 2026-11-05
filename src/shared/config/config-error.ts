import { z } from 'zod';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(error: z.ZodError) {
    super(`Invalid environment configuration:\n${z.prettifyError(error)}`, { cause: error });
  }
}
