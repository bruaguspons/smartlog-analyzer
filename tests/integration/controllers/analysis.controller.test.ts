import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '@/app.js';
import { analysisRunner } from '@/services/analysis-runner.js';
import { prisma } from '@/shared/db/prisma.js';
import { hangUntilAborted, okJson, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';
import { analysisId, makeLog, makeService } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabase, settleAnalyses } from '@tests/support/integration/database.js';
import { scriptedLlm } from '@tests/support/fakes/scripted-llm.js';

// Analysis ids come from one counter (the same values as `analysisId(n)`), the clock is fixed and the model is scripted.
const ids = vi.hoisted(() => ({ counter: 0 }));
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUIDv7: () => `0192f1c0-aaaa-7000-8000-${String((ids.counter += 1)).padStart(12, '0')}`,
}));
vi.mock('@/llm/llm.js', async () => (await import('@tests/support/fakes/scripted-llm-module.js')).scriptedLlmModule());

const NOW = new Date('2026-11-04T12:00:00.000Z');
const headers = { 'x-api-key': 'k-active' };

interface AnalysisBody {
  id: string;
  hasMore: boolean;
  nextCursor: string | null;
  status: string;
  durationMs: number | null;
  summary: string | null;
  findings: { logIds: string[] }[];
  tokens: unknown;
  error: { code: string } | null;
}

const llm = scriptedLlm();

/** Stores `logCount` logs and scripts the model with `script`. */
async function build(logCount: number, ...script: ScriptStep[]): Promise<void> {
  await insertLogs(Array.from({ length: logCount }, (_, i) => makeLog(i + 1)));
  ids.counter = 0;
  llm.reset(...(script.length > 0 ? script : [okJson({ summary: 'Summary', findings: [] })]));
}

const post = (payload: object = {}, h: Record<string, string> = headers) =>
  request(app).post('/api/logs/analyze').set(h).send(payload);
const get = (id: string, h: Record<string, string> = headers) => request(app).get(`/api/analysis/${id}`).set(h);
const body = (res: { body: unknown }) => res.body as AnalysisBody;

beforeAll(async () => {
  await prisma.$connect();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await prisma.service.createMany({
    data: [makeService(1, { apiKey: 'k-active' }), makeService(2, { apiKey: 'k-off', isActive: false })],
  });
});

afterEach(async () => {
  await settleAnalyses({ llm, runner: analysisRunner });
});

describe('POST /api/logs/analyze against Postgres', () => {
  it('answers 202 with the UUID, hasMore and nextCursor', async () => {
    await build(3);
    const res = await post();
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: analysisId(1), hasMore: false, nextCursor: null });
  });

  it('hasMore and nextCursor when the filters match more than one page', async () => {
    await build(5);
    const res = await post({ limit: 2 });
    expect(res.status).toBe(202);
    expect(body(res).hasMore).toBe(true);
    expect(typeof body(res).nextCursor).toBe('string');
  });

  it('invalid limit or unknown key is a 400 VALIDATION_ERROR', async () => {
    await build(1);
    for (const payload of [{ limit: 201 }, { foo: 1 }]) {
      const res = await post(payload);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('no matching logs is a 422 NO_LOGS_TO_ANALYZE and stores nothing', async () => {
    await build(0);
    const res = await post();
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'NO_LOGS_TO_ANALYZE' } });
    expect(await prisma.analysis.count()).toBe(0);
  });

  it('a second POST while one is PROCESSING is a 409 with the running id in details', async () => {
    await build(2, hangUntilAborted);
    const first = await post();

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'ANALYSIS_IN_PROGRESS', details: { id: body(first).id } } });
  });
});

describe('GET /api/analysis/:id against Postgres', () => {
  it('a COMPLETED analysis returns findings, logIds and tokens without any rawResponse key', async () => {
    await build(
      2,
      okJson(
        { summary: 'Summary', findings: [{ category: 'DATABASE', severity: 'HIGH', description: 'd', suggestions: ['s'], logRefs: [1] }] },
        { prompt: 9, completion: 4 },
      ),
    );
    const { id } = body(await post());
    await analysisRunner.idle();

    const res = await get(id);

    expect(res.status).toBe(200);
    const json = body(res);
    expect(json).toMatchObject({
      id,
      status: 'COMPLETED',
      summary: 'Summary',
      logCount: 2,
      provider: 'scripted',
      model: 'scripted-model',
      tokens: { prompt: 9, completion: 4 },
      error: null,
      createdAt: NOW.toISOString(),
    });
    // Log refs are 1-based positions in the page, which is ordered newest first: ref 1 is the second log.
    expect(json.findings).toHaveLength(1);
    expect(json.findings[0]).toMatchObject({
      id: expect.any(Number) as number,
      category: 'DATABASE',
      severity: 'HIGH',
      suggestions: ['s'],
      logIds: [makeLog(2).id],
    });
    // The exact key set is the contract: the stored raw response must not leak.
    expect(Object.keys(json).sort()).toEqual([
      'createdAt',
      'durationMs',
      'error',
      'findings',
      'id',
      'logCount',
      'model',
      'provider',
      'status',
      'summary',
      'tokens',
    ]);
  });

  it('a PROCESSING analysis has null summary and duration and no findings', async () => {
    await build(1, hangUntilAborted);
    const { id } = body(await post());

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'PROCESSING', summary: null, findings: [], durationMs: null, tokens: null, error: null });
  });

  it('a FAILED analysis carries the error and the token usage the provider reported', async () => {
    await build(1, { text: '{"summary":"x"}', usage: { prompt: 3, completion: 1 } });
    const { id } = body(await post());
    await analysisRunner.idle();

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'FAILED', error: { code: 'LLM_INVALID_RESPONSE' }, tokens: { prompt: 3, completion: 1 } });
  });

  it('a non-UUID id is a 400 and an unknown UUID a 404', async () => {
    await build(1);
    expect((await get('not-a-uuid')).status).toBe(400);
    const res = await get(analysisId(99));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('analysis authentication', () => {
  it('a missing, unknown or inactive key gives the same 401 on POST and GET', async () => {
    await build(1);
    const bodies = new Set<string>();
    const wrongHeaders: Record<string, string>[] = [{}, { 'x-api-key': 'nope' }, { 'x-api-key': 'k-off' }];
    for (const h of wrongHeaders) {
      for (const res of [await post({}, h), await get(analysisId(1), h)]) {
        expect(res.status).toBe(401);
        bodies.add(res.text);
      }
    }
    expect(bodies.size).toBe(1);
  });

  it('is documented in the OpenAPI document', async () => {
    await build(1);
    const res = await request(app).get('/docs/json');
    expect(Object.keys((res.body as { paths: object }).paths)).toEqual(expect.arrayContaining(['/api/logs/analyze', '/api/analysis/{id}']));
  });
});
