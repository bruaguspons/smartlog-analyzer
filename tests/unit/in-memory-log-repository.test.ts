import { InMemoryLogRepository } from '../../src/modules/logs/infrastructure/in-memory-log-repository.js';
import { runLogListContract } from '../shared/log-repository-list-contract.js';

runLogListContract(() => {
  const repo = new InMemoryLogRepository();
  return Promise.resolve({
    repo,
    seed: async (logs) => {
      for (const log of logs) await repo.create(log);
    },
  });
});
