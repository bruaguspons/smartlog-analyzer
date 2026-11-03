import type { Service } from './service.js';

export interface ServiceRepository {
  findByApiKey(apiKey: string): Promise<Service | null>;
}
