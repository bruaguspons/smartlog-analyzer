import type { RequestHandler } from 'express';
import type { Service } from '@/models/service.js';
import { serviceRepository } from '@/repositories/service.repository.js';
import { UnauthorizedError } from '@/shared/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** The authenticated service, set by `requireApiKey` on every route that is not public. */
      service: Service;
    }
  }
}

const MAX_KEY_LENGTH = 256;

/**
 * Resolves the calling service from `X-API-Key` into `res.locals.service`. Missing, empty, too long,
 * unknown and inactive keys all give the same 401, so the response reveals nothing. Never logs the key.
 */
export const requireApiKey: RequestHandler = async (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey !== 'string' || apiKey === '' || apiKey.length > MAX_KEY_LENGTH) throw new UnauthorizedError();
  const service = await serviceRepository.findByApiKey(apiKey);
  if (service === null || !service.isActive) throw new UnauthorizedError();
  res.locals.service = service;
  next();
};
