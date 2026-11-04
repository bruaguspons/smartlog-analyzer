import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';
import { runServiceRepositoryContract } from '../shared/service-repository-contract.js';

runServiceRepositoryContract((services) => Promise.resolve(new InMemoryServiceRepository(services)));
