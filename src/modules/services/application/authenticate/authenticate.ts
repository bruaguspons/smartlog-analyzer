import { UnauthorizedError } from '@/shared/errors/unauthorized-error.js';
import type { Service } from '@/modules/services/domain/service.types.js';
import type { ServiceRepository } from '@/modules/services/domain/service-repository.types.js';

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
