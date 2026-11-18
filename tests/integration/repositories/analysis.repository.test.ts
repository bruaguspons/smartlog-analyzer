import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { NewFinding } from '@/models/analysis.js';
import { PrismaAnalysisRepository } from '@/repositories/prisma-analysis.repository.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { analysisId, logId, makeLog } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabaseWithService } from '@tests/support/integration/database.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const repository = new PrismaAnalysisRepository(prisma);

const CREATED_AT = new Date('2026-11-04T10:00:00.000Z');

const newAnalysis = (n: number) => ({ id: analysisId(n), provider: 'mock', model: 'mock', createdAt: CREATED_AT });

const usage = { prompt: 120, completion: 45 };

const finding = (overrides: Partial<NewFinding> = {}): NewFinding => ({
  category: 'DATABASE',
  severity: 'HIGH',
  description: 'Connection pool exhausted',
  suggestions: ['Increase the pool size', 'Add a timeout'],
  logIds: [logId(1), logId(2)],
  ...overrides,
});

const result = (overrides: Record<string, unknown> = {}) => ({
  summary: 'Analysis summary',
  findings: [finding()],
  rawResponse: '{"summary":"x"}',
  usage,
  durationMs: 1500,
  ...overrides,
});

const failure = (overrides: Record<string, unknown> = {}) => ({
  errorCode: 'LLM_TIMEOUT' as const,
  errorMessage: 'The LLM did not answer in time',
  rawResponse: null,
  usage: null,
  durationMs: 900,
  ...overrides,
});

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('PrismaAnalysisRepository', () => {
  it('rolls the analysis back when one of its logs does not exist (atomic create)', async () => {
    await resetDatabaseWithService(prisma);

    await expect(
      repository.createProcessing({ id: analysisId(1), provider: 'mock', model: 'mock', createdAt: new Date() }, [logId(1)]),
    ).rejects.toThrow();

    expect(await prisma.analysis.count()).toBe(0);
  });
});

describe('AnalysisRepository', () => {
  const repo = repository;

  beforeEach(async () => {
    await resetDatabaseWithService(prisma);
    await insertLogs(
      prisma,
      [1, 2, 3].map((n) => makeLog(n)),
    );
  });

  describe('createProcessing', () => {
    it('creates a PROCESSING analysis with its logs and a derived logCount', async () => {
      const outcome = await repo.createProcessing(newAnalysis(1), [logId(1), logId(2), logId(3)]);

      expect(outcome).toEqual({ created: true });
      expect(await repo.findById(analysisId(1))).toEqual({
        id: analysisId(1),
        status: 'PROCESSING',
        createdAt: CREATED_AT,
        durationMs: null,
        logCount: 3,
        provider: 'mock',
        model: 'mock',
        summary: null,
        findings: [],
        tokens: null,
        error: null,
      });
    });

    it('reports the running analysis and creates nothing while one is PROCESSING', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);

      const outcome = await repo.createProcessing(newAnalysis(2), [logId(2)]);

      expect(outcome).toEqual({ created: false, runningId: analysisId(1) });
      expect(await repo.findById(analysisId(2))).toBeNull();
    });

    it('allows a new analysis after the previous one completed', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);
      await repo.complete(analysisId(1), result({ findings: [] }));

      expect(await repo.createProcessing(newAnalysis(2), [logId(2)])).toEqual({ created: true });
    });

    it('allows a new analysis after the previous one failed', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);
      await repo.fail(analysisId(1), failure());

      expect(await repo.createProcessing(newAnalysis(2), [logId(2)])).toEqual({ created: true });
    });
  });

  describe('complete', () => {
    it('stores summary, findings with their logIds, tokens and duration in one step', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1), logId(2), logId(3)]);

      const ok = await repo.complete(
        analysisId(1),
        result({
          findings: [
            finding(),
            finding({ category: 'NETWORK', severity: 'LOW', description: 'Slow DNS', suggestions: [], logIds: [logId(3)] }),
          ],
        }),
      );

      expect(ok).toBe(true);
      const view = await repo.findById(analysisId(1));
      expect(view).toMatchObject({
        status: 'COMPLETED',
        summary: 'Analysis summary',
        durationMs: 1500,
        tokens: usage,
        error: null,
        logCount: 3,
      });
      expect(view?.findings).toHaveLength(2);
      expect(view?.findings[0]).toMatchObject({
        category: 'DATABASE',
        severity: 'HIGH',
        description: 'Connection pool exhausted',
        suggestions: ['Increase the pool size', 'Add a timeout'],
      });
      expect([...(view?.findings[0]?.logIds ?? [])].sort()).toEqual([logId(1), logId(2)]);
      expect(view?.findings[1]).toMatchObject({ category: 'NETWORK', suggestions: [], logIds: [logId(3)] });
      expect(view?.findings[0]?.id).not.toBe(view?.findings[1]?.id);
    });

    it('completes with zero findings and tokens null when the provider reported no usage', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);

      await repo.complete(analysisId(1), result({ findings: [], usage: null }));

      const view = await repo.findById(analysisId(1));
      expect(view).toMatchObject({ status: 'COMPLETED', findings: [], tokens: null });
    });

    it('exposes no rawResponse in the view', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1), logId(2)]);
      await repo.complete(analysisId(1), result());

      const view = await repo.findById(analysisId(1));
      expect(Object.keys(view ?? {})).not.toContain('rawResponse');
    });

    it('rejects findings that reference logs outside the analysis and persists nothing', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);

      await expect(repo.complete(analysisId(1), result({ findings: [finding({ logIds: [logId(1), logId(2)] })] }))).rejects.toThrow();

      expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'PROCESSING', findings: [], summary: null });
    });

    it('returns false and writes nothing when the analysis is already terminal', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);
      await repo.fail(analysisId(1), failure());

      expect(await repo.complete(analysisId(1), result())).toBe(false);

      expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', summary: null, findings: [] });
    });

    it('returns false for an unknown analysis', async () => {
      expect(await repo.complete(analysisId(9), result())).toBe(false);
    });
  });

  describe('fail', () => {
    it('stores the error, tokens and duration', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);

      const ok = await repo.fail(
        analysisId(1),
        failure({ errorCode: 'LLM_INVALID_RESPONSE', errorMessage: 'bad shape', rawResponse: 'not json', usage }),
      );

      expect(ok).toBe(true);
      expect(await repo.findById(analysisId(1))).toMatchObject({
        status: 'FAILED',
        durationMs: 900,
        error: { code: 'LLM_INVALID_RESPONSE', message: 'bad shape' },
        tokens: usage,
        summary: null,
        findings: [],
      });
    });

    it('reports tokens null when the provider gave no usage', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);
      await repo.fail(analysisId(1), failure());
      expect((await repo.findById(analysisId(1)))?.tokens).toBeNull();
    });

    it('first terminal write wins: returns false when already COMPLETED', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);
      await repo.complete(analysisId(1), result({ findings: [] }));

      expect(await repo.fail(analysisId(1), failure())).toBe(false);

      expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'COMPLETED', error: null });
    });

    it('returns false for an unknown analysis', async () => {
      expect(await repo.fail(analysisId(9), failure())).toBe(false);
    });
  });

  describe('failAllProcessing', () => {
    it('marks the PROCESSING analysis INTERRUPTED, returns its id and unblocks new ones', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);

      const ids = await repo.failAllProcessing({ errorCode: 'INTERRUPTED', errorMessage: 'Restarted' });

      expect(ids).toEqual([analysisId(1)]);
      expect(await repo.findById(analysisId(1))).toMatchObject({
        status: 'FAILED',
        durationMs: null,
        error: { code: 'INTERRUPTED', message: 'Restarted' },
      });
      expect(await repo.createProcessing(newAnalysis(2), [logId(2)])).toEqual({ created: true });
    });

    it('returns an empty list and leaves terminal analyses untouched when nothing is PROCESSING', async () => {
      await repo.createProcessing(newAnalysis(1), [logId(1)]);
      await repo.complete(analysisId(1), result({ findings: [] }));

      expect(await repo.failAllProcessing({ errorCode: 'INTERRUPTED', errorMessage: 'Restarted' })).toEqual([]);

      expect((await repo.findById(analysisId(1)))?.status).toBe('COMPLETED');
    });
  });

  describe('findById', () => {
    it('returns null for an unknown id', async () => {
      expect(await repo.findById(analysisId(9))).toBeNull();
    });
  });
});
