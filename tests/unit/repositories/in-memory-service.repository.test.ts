import { InMemoryServiceRepository } from '@/repositories/in-memory-service.repository.js';
import { runServiceRepositoryContract } from '@tests/support/contracts/service-repository-contract.js';

runServiceRepositoryContract((services) => Promise.resolve(new InMemoryServiceRepository(services)));
