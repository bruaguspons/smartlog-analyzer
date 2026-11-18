import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Runtime } from '@/composition/create-runtime.js';
import { recoverInterrupted } from '@/services/analysis-runner.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';
import { PrismaAnalysisRepository } from '@/repositories/prisma-analysis.repository.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { analysisId, logId } from '@tests/support/contracts/analysis-repository-contract.js';
import { hangUntilAborted, okJson, ScriptedLlmClient, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';
import { authHeaders as headers, buildIntegrationRuntime, resetDatabase } from '@tests/support/integration/integration-app.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const analysisRepo = new PrismaAnalysisRepository(prisma);
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

interface Body {
  id: string;
  error?: { code: string; details?: { id: string } };
}

let runtime: Runtime;
let runner: Runtime['runner'];

function build(wrapAnalysisRepo: ((repo: AnalysisRepository) => AnalysisRepository) | undefined, ...script: ScriptStep[]): void {
  runtime = buildIntegrationRuntime({
    prisma,
    llm: new ScriptedLlmClient(...script),
    ...(wrapAnalysisRepo && { wrapAnalysisRepo }),
  });
  ({ runner } = runtime);
}

const post = () => request(runtime.app).post('/api/logs/analyze').set(headers).send({});
const body = (res: { body: unknown }) => res.body as Body;

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(prisma);
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
  await runtime.close();
});

describe('analysis flow against Postgres', () => {
  it('two simultaneous POSTs produce exactly one 202 and one 409 naming the winner', async () => {
    build(undefined, hangUntilAborted);

    const results = await Promise.all([post(), post()]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([202, 409]);
    const accepted = results.find((r) => r.status === 202);
    const rejected = results.find((r) => r.status === 409);
    if (!accepted || !rejected) throw new Error('expected one 202 and one 409');
    const winner = body(accepted);
    const loser = body(rejected);
    expect(loser.error).toMatchObject({ code: 'ANALYSIS_IN_PROGRESS', details: { id: winner.id } });
    expect(await prisma.analysis.count()).toBe(1);
    expect(await prisma.analysisLog.count()).toBe(3);
  });

  it('a new analysis is accepted after the previous one reached a terminal state', async () => {
    build(undefined, okJson({ summary: 'Summary', findings: [] }));
    expect((await post()).status).toBe(202);
    await runner.idle();
    expect(await prisma.analysis.count({ where: { status: 'COMPLETED' } })).toBe(1);

    const second = await post();

    expect(second.status).toBe(202);
  });

  it('startup recovery closes leftover PROCESSING rows and unblocks POST', async () => {
    build(undefined, okJson({ summary: 'Summary', findings: [] }));
    await analysisRepo.createProcessing(
      { id: analysisId(1), provider: 'mock', model: 'mock', createdAt: new Date() },
      [logId(1)],
    );
    expect((await post()).status).toBe(409);

    await recoverInterrupted(analysisRepo, silent);

    expect(await prisma.analysis.findUniqueOrThrow({ where: { id: analysisId(1) } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'INTERRUPTED',
    });
    expect((await post()).status).toBe(202);
  });

  it('when saving the COMPLETED result fails nothing partial is stored and the analysis ends FAILED', async () => {
    const finding = { category: 'DATABASE', severity: 'HIGH', description: 'd', suggestions: [], logRefs: [1] };
    // Sabotage: add a finding that points at a log outside the analysis, which the repository rejects.
    const sabotage = (repo: AnalysisRepository): AnalysisRepository => ({
      createProcessing: (a, ids) => repo.createProcessing(a, ids),
      complete: (id, input) =>
        repo.complete(id, {
          ...input,
          findings: [...input.findings, { category: 'OTHER', severity: 'LOW', description: 'x', suggestions: [], logIds: [logId(99)] }],
        }),
      fail: (id, input) => repo.fail(id, input),
      failAllProcessing: (input) => repo.failAllProcessing(input),
      findById: (id) => repo.findById(id),
    });
    build(sabotage, okJson({ summary: 'Summary', findings: [finding] }, { prompt: 8, completion: 2 }));

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
