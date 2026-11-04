import { describe, expect, it, vi } from 'vitest';
import { startAnalysis, type StartAnalysisDeps } from '../../src/modules/analysis/application/start-analysis.js';
import { InMemoryAnalysisRepository } from '../../src/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { InMemoryLogRepository } from '../../src/modules/logs/infrastructure/in-memory-log-repository.js';
import { ConflictError, UnprocessableError } from '../../src/shared/errors/app-error.js';
import { analysisId } from '../shared/analysis-repository-contract.js';
import { makeListLog } from '../shared/log-repository-list-contract.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');

function setup(logCount: number) {
  const logRepo = new InMemoryLogRepository();
  for (let n = 1; n <= logCount; n += 1) logRepo.logs.push(makeListLog(n));
  const analysisRepo = new InMemoryAnalysisRepository();
  const runner = { start: vi.fn<StartAnalysisDeps['runner']['start']>() };
  let counter = 0;
  const deps: StartAnalysisDeps = {
    logRepo,
    analysisRepo,
    runner,
    llm: { provider: 'scripted', model: 'scripted-model' },
    newId: () => analysisId((counter += 1)),
    now: () => NOW,
  };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { deps, analysisRepo, runner, log };
}

describe('startAnalysis', () => {
  it('inserts a PROCESSING analysis with its logs, then starts the runner and returns the page info', async () => {
    const { deps, analysisRepo, runner, log } = setup(3);
    const createProcessing = vi.spyOn(analysisRepo, 'createProcessing');

    const result = await startAnalysis({ filters: {}, limit: 50 }, log, deps);

    expect(result).toEqual({ id: analysisId(1), hasMore: false, nextCursor: null });
    expect(await analysisRepo.findById(analysisId(1))).toMatchObject({
      status: 'PROCESSING',
      logCount: 3,
      provider: 'scripted',
      model: 'scripted-model',
      createdAt: NOW,
    });
    expect(runner.start).toHaveBeenCalledOnce();
    const [job, passedLog] = runner.start.mock.calls[0] ?? [];
    expect(job).toMatchObject({ analysisId: analysisId(1), createdAt: NOW });
    expect(job?.logs).toHaveLength(3);
    expect(passedLog).toBe(log);
    expect(createProcessing.mock.invocationCallOrder[0]).toBeLessThan(runner.start.mock.invocationCallOrder[0] ?? 0);
  });

  it('analyzes only one page and reports hasMore and nextCursor', async () => {
    const { deps, analysisRepo, runner, log } = setup(5);

    const result = await startAnalysis({ filters: {}, limit: 2 }, log, deps);

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect((await analysisRepo.findById(result.id))?.logCount).toBe(2);
    expect(runner.start.mock.calls[0]?.[0].logs).toHaveLength(2);
  });

  it('an empty page is a 422 NO_LOGS_TO_ANALYZE before any insert', async () => {
    const { deps, analysisRepo, runner, log } = setup(0);
    const createProcessing = vi.spyOn(analysisRepo, 'createProcessing');

    const error: unknown = await startAnalysis({ filters: {}, limit: 50 }, log, deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableError);
    expect(error).toMatchObject({ statusCode: 422, code: 'NO_LOGS_TO_ANALYZE' });
    expect(createProcessing).not.toHaveBeenCalled();
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('a second analysis while one is PROCESSING is a 409 carrying the running id, without starting a job', async () => {
    const { deps, analysisRepo, runner, log } = setup(3);
    const first = await startAnalysis({ filters: {}, limit: 50 }, log, deps);

    const error: unknown = await startAnalysis({ filters: {}, limit: 50 }, log, deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ statusCode: 409, code: 'ANALYSIS_IN_PROGRESS', details: { id: first.id } });
    expect(runner.start).toHaveBeenCalledOnce();
    expect(await analysisRepo.findById(analysisId(2))).toBeNull();
  });

  it('a new analysis is accepted once the previous one is terminal', async () => {
    const { deps, analysisRepo, log } = setup(1);
    const first = await startAnalysis({ filters: {}, limit: 50 }, log, deps);
    await analysisRepo.fail(first.id, { errorCode: 'INTERNAL_ERROR', errorMessage: 'x', rawResponse: null, usage: null, durationMs: 1 });

    const second = await startAnalysis({ filters: {}, limit: 50 }, log, deps);

    expect(second.id).toBe(analysisId(2));
  });

  it('applies the filters to the page', async () => {
    const { deps, analysisRepo, log } = setup(4);
    const result = await startAnalysis({ filters: { search: 'message 3' }, limit: 50 }, log, deps);
    expect((await analysisRepo.findById(result.id))?.logCount).toBe(1);
  });
});
