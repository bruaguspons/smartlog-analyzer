import { InMemoryAnalysisRepository } from '@/repositories/in-memory-analysis.repository.js';
import { runAnalysisRepositoryContract } from '@tests/support/contracts/analysis-repository-contract.js';

runAnalysisRepositoryContract(() =>
  Promise.resolve({
    repo: new InMemoryAnalysisRepository(),
    seedLogs: () => Promise.resolve(),
  }),
);
