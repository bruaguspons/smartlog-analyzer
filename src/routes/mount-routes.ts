import type { RequestHandler, Router } from 'express';
import type { z } from 'zod';

/** One API route: the single description both Express (mounting) and the OpenAPI document are built from. */
export interface RouteDefinition {
  method: 'get' | 'post';
  /** Relative to `/api`, Express syntax (`/analysis/:id`). */
  path: string;
  summary: string;
  tags: string[];
  /** Skips the `X-API-Key` check (only the health probe). */
  public?: true;
  request?: { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType };
  responses: Record<number, z.ZodType>;
  handler: RequestHandler;
}

export interface RouteMiddlewares {
  auth: RequestHandler;
  json: RequestHandler;
}

/**
 * Chain per route: auth (unless public), then the body parser (only routes with a body), then the handler.
 * Auth is per route, not router-wide: an unknown `/api/x` must stay a 404 and not turn into a 401,
 * and authentication must run before the body is read (a bad key beats a bad body).
 */
export function mountRoutes(router: Router, routes: readonly RouteDefinition[], { auth, json }: RouteMiddlewares): Router {
  for (const route of routes) {
    router[route.method](
      route.path,
      ...(route.public ? [] : [auth]),
      ...(route.request?.body ? [json] : []),
      route.handler,
    );
  }
  return router;
}
