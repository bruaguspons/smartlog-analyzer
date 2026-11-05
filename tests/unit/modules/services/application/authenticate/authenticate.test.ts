import { describe, expect, it, vi } from 'vitest';
import { authenticate } from '@/modules/services/application/authenticate/authenticate.js';
import type { Service } from '@/modules/services/domain/service.types.js';
import type { ServiceRepository } from '@/modules/services/domain/service-repository.types.js';
import { UnauthorizedError } from '@/shared/errors/unauthorized-error.js';

const active: Service = { id: 1, name: 'svc', description: null, apiKey: 'k-active', isActive: true };
const inactive: Service = { ...active, id: 2, apiKey: 'k-off', isActive: false };

function repoReturning(service: Service | null) {
  const findByApiKey = vi.fn<(key: string) => Promise<Service | null>>().mockResolvedValue(service);
  return { repo: { findByApiKey, findNamesByIds: () => Promise.resolve(new Map()) } satisfies ServiceRepository, findByApiKey };
}

describe('authenticate', () => {
  it('returns the service for an active key, querying once', async () => {
    const { repo, findByApiKey } = repoReturning(active);
    await expect(authenticate('k-active', repo)).resolves.toBe(active);
    expect(findByApiKey).toHaveBeenCalledTimes(1);
    expect(findByApiKey).toHaveBeenCalledWith('k-active');
  });

  it.each([
    ['undefined', undefined],
    ['non-string', 42],
    ['array', ['a', 'b']],
    ['empty', ''],
    ['oversized', 'x'.repeat(257)],
  ])('rejects %s key without querying the repository', async (_label, key) => {
    const { repo, findByApiKey } = repoReturning(active);
    await expect(authenticate(key, repo)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('fails with the same error class and message for missing, unknown and inactive', async () => {
    const errors = await Promise.all(
      [
        authenticate(undefined, repoReturning(null).repo),
        authenticate('nope', repoReturning(null).repo),
        authenticate('k-off', repoReturning(inactive).repo),
      ].map((p) => p.then(() => null, (e: unknown) => e)),
    );
    for (const e of errors) expect(e).toBeInstanceOf(UnauthorizedError);
    expect(new Set(errors.map((e) => (e as Error).message)).size).toBe(1);
  });
});
