import { describe, expect, it, vi } from 'vitest';
import { recoverInterrupted } from '../../src/modules/analysis/application/recover-interrupted.js';
import { InMemoryAnalysisRepository } from '../../src/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { analysisId, logId } from '../shared/analysis-repository-contract.js';

describe('recoverInterrupted', () => {
  it('S17: leftover PROCESSING rows become FAILED/INTERRUPTED and the next analysis can start', async () => {
    const repo = new InMemoryAnalysisRepository();
    const created = { provider: 'mock', model: 'mock', createdAt: new Date() };
    await repo.createProcessing({ id: analysisId(1), ...created }, [logId(1)]);
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const ids = await recoverInterrupted(repo, log);

    expect(ids).toEqual([analysisId(1)]);
    expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
    expect(await repo.createProcessing({ id: analysisId(2), ...created }, [logId(1)])).toEqual({ created: true });
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('does nothing and stays quiet when there is nothing to recover', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    expect(await recoverInterrupted(new InMemoryAnalysisRepository(), log)).toEqual([]);
    expect(log.warn).not.toHaveBeenCalled();
  });
});
