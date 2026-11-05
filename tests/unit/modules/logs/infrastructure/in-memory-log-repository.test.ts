import type { Log } from '@/modules/logs/domain/log.types.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';
import { runLogListContract } from '@tests/support/contracts/log-repository-list-contract.js';
import { runLogStatsContract } from '@tests/support/contracts/log-repository-stats-contract.js';

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
