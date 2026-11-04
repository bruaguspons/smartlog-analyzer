import { describe, expect, it } from 'vitest';
import type { Service } from '../../src/modules/services/domain/service.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';

const svc = (id: number, isActive = true): Service => ({
  id,
  name: `svc-${id}`,
  description: null,
  apiKey: `key-${id}`,
  isActive,
});

describe('InMemoryServiceRepository.findNamesByIds', () => {
  const repo = new InMemoryServiceRepository([svc(1), svc(2, false)]);

  it('returns an empty map for no ids', async () => {
    expect((await repo.findNamesByIds([])).size).toBe(0);
  });

  it('resolves existing ids, inactive services included', async () => {
    expect(await repo.findNamesByIds([1, 2])).toEqual(
      new Map([
        [1, 'svc-1'],
        [2, 'svc-2'],
      ]),
    );
  });

  it('omits unknown ids without failing', async () => {
    expect(await repo.findNamesByIds([1, 99])).toEqual(new Map([[1, 'svc-1']]));
  });

  it('resolves duplicated ids once', async () => {
    expect(await repo.findNamesByIds([1, 1])).toEqual(new Map([[1, 'svc-1']]));
  });
});
