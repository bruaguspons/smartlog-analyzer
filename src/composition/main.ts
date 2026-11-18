import { createRuntime, type Runtime } from './create-runtime.js';
import { registerGracefulShutdown } from './graceful-shutdown.js';

/** Process-level effects of `main`, injectable so failures can be tested without exiting. */
export interface ProcessIo {
  exit(code: number): void;
  registerShutdown(runtime: Runtime): void;
}

export const defaultProcessIo: ProcessIo = {
  exit: (code) => process.exit(code),
  registerShutdown: (runtime) => {
    registerGracefulShutdown(runtime);
  },
};

/** Entry point: a failed startup is reported and ends in exit code 1. Invalid configuration already ended the process on import. */
export async function main(io: ProcessIo = defaultProcessIo): Promise<void> {
  const runtime = createRuntime();
  io.registerShutdown(runtime);
  try {
    await runtime.start();
  } catch (err) {
    runtime.logger.error(err);
    io.exit(1);
  }
}
