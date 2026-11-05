import { registerGracefulShutdown } from '@/shared/http/graceful-shutdown/register-graceful-shutdown.js';
import type { ProcessIo } from './process-io.types.js';

export const defaultProcessIo: ProcessIo = {
  exit: (code) => process.exit(code),
  error: (message) => {
    console.error(message);
  },
  registerShutdown: (app) => {
    registerGracefulShutdown(app);
  },
};
