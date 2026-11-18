import { ConfigError, loadConfig, type Config } from '@/shared/config/load-config.js';
import { createPrismaDeps } from './create-prisma-deps.js';
import { createRuntime, type Runtime, type RuntimeDeps } from './create-runtime.js';
import { registerGracefulShutdown } from './graceful-shutdown.js';

/** Process-level effects of `main`, injectable so failures can be tested without exiting. */
export interface ProcessIo {
  exit(code: number): void;
  error(message: string): void;
  registerShutdown(runtime: Runtime): void;
}

export const defaultProcessIo: ProcessIo = {
  exit: (code) => process.exit(code),
  error: (message) => {
    console.error(message);
  },
  registerShutdown: (runtime) => {
    registerGracefulShutdown(runtime);
  },
};

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
  io.registerShutdown(runtime);
  try {
    await runtime.start();
  } catch (err) {
    runtime.logger.error(err);
    io.exit(1);
  }
}
