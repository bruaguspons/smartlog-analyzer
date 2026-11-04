import { describe, expect, it } from 'vitest';
import type { Service } from '../../src/modules/services/domain/service.js';
import type { ServiceRepository } from '../../src/modules/services/domain/service-repository.js';

export const makeService = (id: number, overrides: Partial<Service> = {}): Service => ({
  id,
  name: `svc-${String(id)}`,
  description: null,
  apiKey: `key-${String(id)}`,
  isActive: true,
  ...overrides,
});

/**
 * Behaviour every `ServiceRepository` implementation must satisfy.
 * `make` must return a repository holding exactly the given services (ids included).
 */
export function runServiceRepositoryContract(make: (services: Service[]) => Promise<ServiceRepository>): void {
  describe('ServiceRepository contract', () => {
    describe('findByApiKey', () => {
      it('returns the stored active service', async () => {
        const repo = await make([makeService(1, { description: 'd' })]);

        expect(await repo.findByApiKey('key-1')).toEqual(makeService(1, { description: 'd' }));
      });

      it('returns null for an unknown key', async () => {
        const repo = await make([makeService(1)]);

        expect(await repo.findByApiKey('missing')).toBeNull();
      });

      it('matches the key case-sensitively', async () => {
        const repo = await make([makeService(1, { apiKey: 'Key-1' })]);

        expect(await repo.findByApiKey('key-1')).toBeNull();
      });

      it('returns inactive services as inactive', async () => {
        const repo = await make([makeService(1, { isActive: false })]);

        expect((await repo.findByApiKey('key-1'))?.isActive).toBe(false);
      });
    });

    describe('findNamesByIds', () => {
      it('returns an empty map for no ids', async () => {
        const repo = await make([makeService(1)]);

        expect((await repo.findNamesByIds([])).size).toBe(0);
      });

      it('resolves existing ids, inactive services included', async () => {
        const repo = await make([makeService(1), makeService(2, { isActive: false })]);

        expect(await repo.findNamesByIds([1, 2])).toEqual(
          new Map([
            [1, 'svc-1'],
            [2, 'svc-2'],
          ]),
        );
      });

      it('omits unknown ids without failing', async () => {
        const repo = await make([makeService(1)]);

        expect(await repo.findNamesByIds([1, 99])).toEqual(new Map([[1, 'svc-1']]));
      });

      it('tolerates duplicated ids', async () => {
        const repo = await make([makeService(1)]);

        expect(await repo.findNamesByIds([1, 1])).toEqual(new Map([[1, 'svc-1']]));
      });
    });
  });
}
