import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { analysisRepository as analysisRepo } from '@/repositories/analysis.repository.js';
import { analysisRunner } from '@/services/analysis-runner.js';
import { analysisService } from '@/services/analysis.service.js';
import { ConflictError, NotFoundError, UnprocessableError } from '@/shared/errors.js';
import { prisma } from '@/shared/db/prisma.js';
import { analysisId, logId, makeLog } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabaseWithService } from '@tests/support/integration/database.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');

// Analysis ids come from one counter (the same values as `analysisId(n)`) and the model is a scripted one.
const ids = vi.hoisted(() => ({ counter: 0 }));
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUIDv7: () => `0192f1c0-aaaa-7000-8000-${String((ids.counter += 1)).padStart(12, '0')}`,
}));
vi.mock('@/llm/llm.js', async () => (await import('@tests/support/fakes/scripted-llm-module.js')).scriptedLlmModule());

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** The service under test, with the runner replaced by a spy so no job runs. */
function setup() {
  const runner = vi.spyOn(analysisRunner, 'start').mockImplementation(() => undefined);
  return { service: analysisService, runner };
}

const seedLogs = (count: number) =>
  insertLogs(Array.from({ length: count }, (_, i) => makeLog(i + 1)),
  );

beforeAll(async () => {
  await prisma.$connect();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  ids.counter = 0;
  await resetDatabaseWithService();
});

describe('AnalysisService.start against Postgres', () => {
  it('inserts a PROCESSING analysis with its logs, then starts the runner and returns the page info', async () => {
    await seedLogs(3);
    const { service, runner } = setup();
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
    expect(runner).toHaveBeenCalledOnce();
    const [job, passedLog] = runner.mock.calls[0] ?? [];
    expect(job).toMatchObject({ analysisId: analysisId(1), createdAt: NOW });
    expect(job?.logs).toHaveLength(3);
    expect(passedLog).toBe(log);
    expect(createProcessing.mock.invocationCallOrder[0]).toBeLessThan(runner.mock.invocationCallOrder[0] ?? 0);
  });

  it('analyzes only one page and reports hasMore and nextCursor', async () => {
    await seedLogs(5);
    const { service, runner } = setup();

    const result = await service.start({ filters: {}, limit: 2 }, log);

    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect((await analysisRepo.findById(result.id))?.logCount).toBe(2);
    expect(runner.mock.calls[0]?.[0].logs).toHaveLength(2);
  });

  it('an empty page is a 422 NO_LOGS_TO_ANALYZE before any insert', async () => {
    const { service, runner } = setup();
    const createProcessing = vi.spyOn(analysisRepo, 'createProcessing');

    const error: unknown = await service.start({ filters: {}, limit: 50 }, log).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnprocessableError);
    expect(error).toMatchObject({ statusCode: 422, code: 'NO_LOGS_TO_ANALYZE' });
    expect(createProcessing).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
  });

  it('a second analysis while one is PROCESSING is a 409 carrying the running id, without starting a job', async () => {
    await seedLogs(3);
    const { service, runner } = setup();
    const first = await service.start({ filters: {}, limit: 50 }, log);

    const error: unknown = await service.start({ filters: {}, limit: 50 }, log).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ statusCode: 409, code: 'ANALYSIS_IN_PROGRESS', details: { id: first.id } });
    expect(runner).toHaveBeenCalledOnce();
    expect(await analysisRepo.findById(analysisId(2))).toBeNull();
  });

  it('a new analysis is accepted once the previous one is terminal', async () => {
    await seedLogs(1);
    const { service } = setup();
    const first = await service.start({ filters: {}, limit: 50 }, log);
    await analysisRepo.fail(first.id, { errorCode: 'INTERNAL_ERROR', errorMessage: 'x', rawResponse: null, usage: null, durationMs: 1 });

    const second = await service.start({ filters: {}, limit: 50 }, log);

    expect(second.id).toBe(analysisId(2));
  });

  it('applies the filters to the page', async () => {
    await seedLogs(4);
    const { service } = setup();

    const result = await service.start({ filters: { search: 'message 3' }, limit: 50 }, log);

    expect((await analysisRepo.findById(result.id))?.logCount).toBe(1);
  });
});

describe('AnalysisService.get against Postgres', () => {
  it('returns the stored view', async () => {
    await seedLogs(1);
    await analysisRepo.createProcessing({ id: analysisId(1), provider: 'mock', model: 'mock', createdAt: new Date() }, [logId(1)]);

    expect(await setup().service.get(analysisId(1))).toMatchObject({ id: analysisId(1), status: 'PROCESSING', logCount: 1 });
  });

  it('an unknown id is a 404 NOT_FOUND', async () => {
    const error: unknown = await setup().service.get(analysisId(9)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
  });
});
