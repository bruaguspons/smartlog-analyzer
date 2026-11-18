import { Router } from 'express';
import { healthController } from '@/controllers/health.controller.js';
import { healthResponseSchema } from '@/schemas/health.schema.js';
import { documentRoute } from './openapi.js';

export const healthRouter = Router({ strict: true, caseSensitive: true });

// The only public route: no API key, no body.
documentRoute({
  method: 'get',
  path: '/health',
  summary: 'Check that the API and its database are up',
  tags: ['health'],
  public: true,
  responses: { 200: healthResponseSchema },
});
healthRouter.get('/health', healthController.health);
