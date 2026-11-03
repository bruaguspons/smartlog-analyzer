import { UnauthorizedError } from '../../../shared/errors/app-error.js';
import type { Service } from '../domain/service.js';
import type { ServiceRepository } from '../domain/service-repository.js';

const MAX_KEY_LENGTH = 256;

/** Resolves the calling service; every failure is the same UnauthorizedError. */
export async function authenticate(apiKey: unknown, repo: ServiceRepository): Promise<Service> {
  if (typeof apiKey !== 'string' || apiKey === '' || apiKey.length > MAX_KEY_LENGTH) {
    throw new UnauthorizedError();
  }
  const service = await repo.findByApiKey(apiKey);
  if (service === null || !service.isActive) throw new UnauthorizedError();
  return service;
}
