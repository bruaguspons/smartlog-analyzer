// TEMPORARY: bootstrap smoke route. Delete this file (and its registration in
// src/app.ts) when the first real route lands.
import type { FastifyPluginCallback } from 'fastify';

export const helloRoutes: FastifyPluginCallback = (app, _options, done) => {
  app.get(
    '/hello',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
        },
      },
    },
    () => ({ message: 'Hello, World!' }),
  );
  done();
};
