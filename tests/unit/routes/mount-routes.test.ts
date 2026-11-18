import { Router, type RequestHandler } from 'express';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mountRoutes, type RouteDefinition } from '@/routes/mount-routes.js';

const trace: string[] = [];
const step = (name: string): RequestHandler => (_req, _res, next) => {
  trace.push(name);
  next();
};
const handler: RequestHandler = (_req, res) => {
  trace.push('handler');
  res.json({});
};
const base = { summary: 's', tags: [], responses: { 200: z.object({}) }, handler };

function appWith(routes: RouteDefinition[]) {
  const app = express();
  app.use('/api', mountRoutes(Router(), routes, { auth: step('auth'), json: step('json') }));
  return app;
}

describe('mountRoutes', () => {
  it('chains auth, then the body parser, then the handler', async () => {
    trace.length = 0;
    await request(appWith([{ ...base, method: 'post', path: '/with-body', request: { body: z.object({}) } }])).post('/api/with-body');
    expect(trace).toEqual(['auth', 'json', 'handler']);
  });

  it('a route without a body skips the body parser', async () => {
    trace.length = 0;
    await request(appWith([{ ...base, method: 'get', path: '/plain' }])).get('/api/plain');
    expect(trace).toEqual(['auth', 'handler']);
  });

  it('a public route skips auth', async () => {
    trace.length = 0;
    await request(appWith([{ ...base, method: 'get', path: '/open', public: true }])).get('/api/open');
    expect(trace).toEqual(['handler']);
  });
});
