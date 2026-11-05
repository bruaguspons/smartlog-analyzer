import type { FastifyInstance } from 'fastify';

/** Process-level effects of `main`, injectable so failures can be tested without exiting. */
export interface ProcessIo {
  exit(code: number): void;
  error(message: string): void;
  registerShutdown(app: FastifyInstance): void;
}
