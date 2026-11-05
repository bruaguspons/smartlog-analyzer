import { ConfigError } from '@/shared/config/config-error.js';
import type { Config } from '@/shared/config/config.types.js';
import { loadConfig } from '@/shared/config/load-config.js';
import { createPrismaDeps } from './create-prisma-deps.js';
import { createRuntime } from './create-runtime.js';
import { defaultProcessIo } from './default-process-io.js';
import type { ProcessIo } from './process-io.types.js';
import type { RuntimeDeps } from './runtime.types.js';

/** Entry point: invalid config or a failed startup is reported and ends in exit code 1. */
export async function main(
  env: NodeJS.ProcessEnv,
  io: ProcessIo = defaultProcessIo,
  makeDeps: (config: Config) => RuntimeDeps = createPrismaDeps,
): Promise<void> {
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) {
      io.error(err.message);
      io.exit(1);
      return;
    }
    throw err;
  }

  const runtime = createRuntime(config, makeDeps(config));
  io.registerShutdown(runtime.app);
  try {
    await runtime.start();
  } catch (err) {
    runtime.app.log.error(err);
    io.exit(1);
  }
}
