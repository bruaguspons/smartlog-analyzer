import { describe, expect, it } from 'vitest';
import { getAnalysis } from '@/modules/analysis/application/get-analysis/get-analysis.js';
import { InMemoryAnalysisRepository } from '@/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { NotFoundError } from '@/shared/errors/not-found-error.js';
import { analysisId, logId } from '@tests/support/contracts/analysis-repository-contract.js';

describe('getAnalysis', () => {
  it('returns the stored view', async () => {
    const repo = new InMemoryAnalysisRepository();
    await repo.createProcessing({ id: analysisId(1), provider: 'mock', model: 'mock', createdAt: new Date() }, [logId(1)]);

    expect(await getAnalysis(analysisId(1), { repo })).toMatchObject({ id: analysisId(1), status: 'PROCESSING', logCount: 1 });
  });

  it('an unknown id is a 404 NOT_FOUND', async () => {
    const error: unknown = await getAnalysis(analysisId(9), { repo: new InMemoryAnalysisRepository() }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
