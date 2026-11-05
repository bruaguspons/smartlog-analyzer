import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** The Fastify instance a zod-typed route plugin receives. */
export type ZodApi = Parameters<FastifyPluginAsyncZod>[0];
