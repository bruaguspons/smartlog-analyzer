import type { Log } from '@/models/log.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
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
