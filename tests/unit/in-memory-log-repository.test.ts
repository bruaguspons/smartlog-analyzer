import type { Log } from '../../src/modules/logs/domain/log.js';
import { InMemoryLogRepository } from '../../src/modules/logs/infrastructure/in-memory-log-repository.js';
import { runLogListContract } from '../shared/log-repository-list-contract.js';
import { runLogStatsContract } from '../shared/log-repository-stats-contract.js';

const makeRepo = () => {
  const repo = new InMemoryLogRepository();
  return Promise.resolve({
    repo,
    seed: async (logs: Log[]) => {
      for (const log of logs) await repo.create(log);
    },
  });
};

runLogListContract(makeRepo);
runLogStatsContract(makeRepo);
