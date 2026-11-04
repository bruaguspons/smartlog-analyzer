import type { Service } from './service.js';

export interface ServiceRepository {
  findByApiKey(apiKey: string): Promise<Service | null>;
  /** Names of the existing services among `ids` (inactive included); unknown ids are absent. */
  findNamesByIds(ids: readonly number[]): Promise<Map<number, string>>;
}
