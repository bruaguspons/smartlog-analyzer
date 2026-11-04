import { InMemoryAnalysisRepository } from '../../src/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { runAnalysisRepositoryContract } from '../shared/analysis-repository-contract.js';

runAnalysisRepositoryContract(() =>
  Promise.resolve({
    repo: new InMemoryAnalysisRepository(),
    seedLogs: () => Promise.resolve(),
  }),
);
