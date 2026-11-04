import { randomUUIDv7 } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { AnalysisRunner } from '../../src/modules/analysis/application/analysis-runner.js';
import { recoverInterrupted } from '../../src/modules/analysis/application/recover-interrupted.js';
import type { AnalysisRepository } from '../../src/modules/analysis/domain/analysis-repository.js';
import { createAnalysisRoutes } from '../../src/modules/analysis/http/analysis-routes.js';
import { PrismaAnalysisRepository } from '../../src/modules/analysis/infrastructure/prisma-analysis-repository.js';
import { PrismaLogRepository } from '../../src/modules/logs/infrastructure/prisma-log-repository.js';
import { PrismaServiceRepository } from '../../src/modules/services/infrastructure/prisma-service-repository.js';
import { createPrismaClient } from '../../src/shared/db/prisma-client.js';
import { analysisId, logId } from '../shared/analysis-repository-contract.js';
import { hangUntilAborted, okJson, ScriptedLlmClient, type ScriptStep } from '../shared/scripted-llm-client.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const analysisRepo = new PrismaAnalysisRepository(prisma);
const headers = { 'x-api-key': 'key-1' };
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

interface Body {
  id: string;
  error?: { code: string; details?: { id: string } };
}

let app: FastifyInstance;
let runner: AnalysisRunner;

function build(repo: AnalysisRepository, ...script: ScriptStep[]): void {
  const llm = new ScriptedLlmClient(...script);
  runner = new AnalysisRunner({ repo, llm, policy: { timeoutMs: 30_000, maxRetries: 0 }, now: () => new Date() });
  app = buildApp({
    serviceRepository: new PrismaServiceRepository(prisma),
    checkDatabase: () => Promise.resolve(),
    apiRoutes: [
      createAnalysisRoutes({
        logRepo: new PrismaLogRepository(prisma),
        analysisRepo: repo,
        runner,
        llm,
        newId: randomUUIDv7,
        now: () => new Date(),
      }),
    ],
    logLevel: 'silent',
  });
}

const post = () => app.inject({ method: 'POST', url: '/api/logs/analyze', headers, payload: {} });
const body = (res: { json: () => unknown }) => res.json() as Body;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE analyses, logs, services RESTART IDENTITY CASCADE`;
  await prisma.service.create({ data: { name: 'svc', apiKey: 'key-1' } });
  await prisma.log.createMany({
    data: [1, 2, 3].map((n) => ({
      id: logId(n),
      serviceId: 1,
      level: 'ERROR' as const,
      timestamp: new Date(`2026-11-04T09:00:0${String(n)}.000Z`),
      message: `log ${String(n)}`,
    })),
  });
});

afterEach(async () => {
  await runner.shutdown();
  await app.close();
});

describe('analysis flow against Postgres', () => {
  it('S6: two simultaneous POSTs produce exactly one 202 and one 409 naming the winner', async () => {
    build(analysisRepo, hangUntilAborted);

    const results = await Promise.all([post(), post()]);

    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses).toEqual([202, 409]);
    const accepted = results.find((r) => r.statusCode === 202);
    const rejected = results.find((r) => r.statusCode === 409);
    if (!accepted || !rejected) throw new Error('expected one 202 and one 409');
    const winner = body(accepted);
    const loser = body(rejected);
    expect(loser.error).toMatchObject({ code: 'ANALYSIS_IN_PROGRESS', details: { id: winner.id } });
    expect(await prisma.analysis.count()).toBe(1);
    expect(await prisma.analysisLog.count()).toBe(3);
  });

  it('S7: a new analysis is accepted after the previous one reached a terminal state', async () => {
    build(analysisRepo, okJson({ summary: 'Resumen', findings: [] }));
    expect((await post()).statusCode).toBe(202);
    await runner.idle();
    expect(await prisma.analysis.count({ where: { status: 'COMPLETED' } })).toBe(1);

    const second = await post();

    expect(second.statusCode).toBe(202);
  });

  it('S17: startup recovery closes leftover PROCESSING rows and unblocks POST', async () => {
    build(analysisRepo, okJson({ summary: 'Resumen', findings: [] }));
    await analysisRepo.createProcessing(
      { id: analysisId(1), provider: 'mock', model: 'mock', createdAt: new Date() },
      [logId(1)],
    );
    expect((await post()).statusCode).toBe(409);

    await recoverInterrupted(analysisRepo, silent);

    expect(await prisma.analysis.findUniqueOrThrow({ where: { id: analysisId(1) } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'INTERRUPTED',
    });
    expect((await post()).statusCode).toBe(202);
  });

  it('S18: when saving the COMPLETED result fails nothing partial is stored and the analysis ends FAILED', async () => {
    const finding = { category: 'DATABASE', severity: 'HIGH', description: 'd', suggestions: [], logRefs: [1] };
    // Sabotage: add a finding that points at a log outside the analysis, which the repository rejects.
    const sabotaged: AnalysisRepository = {
      createProcessing: (a, ids) => analysisRepo.createProcessing(a, ids),
      complete: (id, input) =>
        analysisRepo.complete(id, {
          ...input,
          findings: [...input.findings, { category: 'OTHER', severity: 'LOW', description: 'x', suggestions: [], logIds: [logId(99)] }],
        }),
      fail: (id, input) => analysisRepo.fail(id, input),
      failAllProcessing: (input) => analysisRepo.failAllProcessing(input),
      findById: (id) => analysisRepo.findById(id),
    };
    build(sabotaged, okJson({ summary: 'Resumen', findings: [finding] }, { prompt: 8, completion: 2 }));

    const { id } = body(await post());
    await runner.idle();

    expect(await prisma.analysisFinding.count()).toBe(0);
    expect(await prisma.findingLog.count()).toBe(0);
    expect(await prisma.analysis.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'INTERNAL_ERROR',
      promptTokens: 8,
      completionTokens: 2,
    });
  });
});
