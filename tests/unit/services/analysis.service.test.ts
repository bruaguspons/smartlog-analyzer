import { describe, expect, it, vi } from 'vitest';
import { InMemoryAnalysisRepository } from '@/repositories/in-memory-analysis.repository.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
import { AnalysisService, type AnalysisServiceDeps } from '@/services/analysis.service.js';
import { LogsService } from '@/services/logs.service.js';
import { ConflictError, NotFoundError, UnprocessableError } from '@/shared/errors.js';
import { analysisId, logId } from '@tests/support/contracts/analysis-repository-contract.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');

function setup(logCount: number) {
  const logRepo = new InMemoryLogRepository();
  for (let n = 1; n <= logCount; n += 1) logRepo.logs.push(makeListLog(n));
  const analysisRepo = new InMemoryAnalysisRepository();
  const runner = { start: vi.fn<AnalysisServiceDeps['runner']['start']>() };
  let counter = 0;
  const logs = new LogsService({ logRepo, serviceRepo: { findByApiKey: vi.fn(), findNamesByIds: vi.fn() }, newId: () => 'unused' });
  const service = new AnalysisService({
    logs,
    analysisRepo,
    runner,
    llm: { provider: 'scripted', model: 'scripted-model' },
    newId: () => analysisId((counter += 1)),
    now: () => NOW,
  });
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { service, analysisRepo, runner, log };
}

describe('AnalysisService.start', () => {
  it('inserts a PROCESSING analysis with its logs, then starts the runner and returns the page info', async () => {
    const { service, analysisRepo, runner, log } = setup(3);
    const createProcessing = vi.spyOn(analysisRepo, 'createProcessing');

    const result = await service.start({ filters: {}, limit: 50 }, log);

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
    const { service, analysisRepo, runner, log } = setup(5);

    const result = await service.start({ filters: {}, limit: 2 }, log);

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect((await analysisRepo.findById(result.id))?.logCount).toBe(2);
    expect(runner.start.mock.calls[0]?.[0].logs).toHaveLength(2);
  });

  it('an empty page is a 422 NO_LOGS_TO_ANALYZE before any insert', async () => {
    const { service, analysisRepo, runner, log } = setup(0);
    const createProcessing = vi.spyOn(analysisRepo, 'createProcessing');

    const error: unknown = await service.start({ filters: {}, limit: 50 }, log).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableError);
    expect(error).toMatchObject({ statusCode: 422, code: 'NO_LOGS_TO_ANALYZE' });
    expect(createProcessing).not.toHaveBeenCalled();
    expect(runner.start).not.toHaveBeenCalled();
  });

  it('a second analysis while one is PROCESSING is a 409 carrying the running id, without starting a job', async () => {
    const { service, analysisRepo, runner, log } = setup(3);
    const first = await service.start({ filters: {}, limit: 50 }, log);

    const error: unknown = await service.start({ filters: {}, limit: 50 }, log).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ statusCode: 409, code: 'ANALYSIS_IN_PROGRESS', details: { id: first.id } });
    expect(runner.start).toHaveBeenCalledOnce();
    expect(await analysisRepo.findById(analysisId(2))).toBeNull();
  });

  it('a new analysis is accepted once the previous one is terminal', async () => {
    const { service, analysisRepo, log } = setup(1);
    const first = await service.start({ filters: {}, limit: 50 }, log);
    await analysisRepo.fail(first.id, { errorCode: 'INTERNAL_ERROR', errorMessage: 'x', rawResponse: null, usage: null, durationMs: 1 });

    const second = await service.start({ filters: {}, limit: 50 }, log);

    expect(second.id).toBe(analysisId(2));
  });

  it('applies the filters to the page', async () => {
    const { service, analysisRepo, log } = setup(4);
    const result = await service.start({ filters: { search: 'message 3' }, limit: 50 }, log);
    expect((await analysisRepo.findById(result.id))?.logCount).toBe(1);
  });
});

describe('AnalysisService.get', () => {
  it('returns the stored view', async () => {
    const { service, analysisRepo } = setup(0);
    await analysisRepo.createProcessing({ id: analysisId(1), provider: 'mock', model: 'mock', createdAt: new Date() }, [logId(1)]);

    expect(await service.get(analysisId(1))).toMatchObject({ id: analysisId(1), status: 'PROCESSING', logCount: 1 });
  });

  it('an unknown id is a 404 NOT_FOUND', async () => {
    const error: unknown = await setup(0).service.get(analysisId(9)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
