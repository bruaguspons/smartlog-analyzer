import type { Service } from '../domain/service.js';
import type { ServiceRepository } from '../domain/service-repository.js';

export class InMemoryServiceRepository implements ServiceRepository {
  private readonly services: readonly Service[];

  constructor(services: readonly Service[] = []) {
    this.services = services;
  }

  findByApiKey(apiKey: string): Promise<Service | null> {
    return Promise.resolve(this.services.find((s) => s.apiKey === apiKey) ?? null);
  }

  findNamesByIds(ids: readonly number[]): Promise<Map<number, string>> {
    const wanted = new Set(ids);
    return Promise.resolve(new Map(this.services.filter((s) => wanted.has(s.id)).map((s) => [s.id, s.name])));
  }
}
