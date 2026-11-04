import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { AnalysisRunner } from '../../src/modules/analysis/application/analysis-runner.js';
import { createAnalysisRoutes } from '../../src/modules/analysis/http/analysis-routes.js';
import { InMemoryAnalysisRepository } from '../../src/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { InMemoryLogRepository } from '../../src/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '../../src/modules/services/domain/service.js';
import { InMemoryServiceRepository } from '../../src/modules/services/infrastructure/in-memory-service-repository.js';
import { analysisId } from '../shared/analysis-repository-contract.js';
import { makeListLog } from '../shared/log-repository-list-contract.js';
import { hangUntilAborted, okJson, ScriptedLlmClient, type ScriptStep } from '../shared/scripted-llm-client.js';

const NOW = new Date('2026-11-04T12:00:00.000Z');
const active: Service = { id: 7, name: 'svc', description: null, apiKey: 'k-active', isActive: true };
const off: Service = { id: 8, name: 'off', description: null, apiKey: 'k-off', isActive: false };
const headers = { 'x-api-key': 'k-active' };

interface Body {
  id: string;
  hasMore: boolean;
  nextCursor: string | null;
  status: string;
  durationMs: number | null;
  summary: string | null;
  findings: { logIds: string[] }[];
  tokens: unknown;
  error: { code: string } | null;
  details?: unknown;
}

describe('analysis routes', () => {
  let app: FastifyInstance;
  let runner: AnalysisRunner;
  let analysisRepo: InMemoryAnalysisRepository;
  let llm: ScriptedLlmClient;

  function build(logCount: number, ...script: ScriptStep[]) {
    const logRepo = new InMemoryLogRepository();
    for (let n = 1; n <= logCount; n += 1) logRepo.logs.push(makeListLog(n));
    analysisRepo = new InMemoryAnalysisRepository();
    llm = new ScriptedLlmClient(...(script.length > 0 ? script : [okJson({ summary: 'Resumen', findings: [] })]));
    runner = new AnalysisRunner({ repo: analysisRepo, llm, policy: { timeoutMs: 30_000, maxRetries: 0 }, now: () => NOW });
    let counter = 0;
    app = buildApp({
      serviceRepository: new InMemoryServiceRepository([active, off]),
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [
        createAnalysisRoutes({ logRepo, analysisRepo, runner, llm, newId: () => analysisId((counter += 1)), now: () => NOW }),
      ],
      logLevel: 'silent',
    });
  }

  afterEach(async () => {
    await runner.shutdown();
    await app.close();
  });

  const post = (payload: unknown = {}, h: Record<string, string> = headers) =>
    app.inject({ method: 'POST', url: '/api/logs/analyze', headers: h, payload: payload as object });
  const get = (id: string, h: Record<string, string> = headers) => app.inject({ method: 'GET', url: `/api/analysis/${id}`, headers: h });
  const body = (res: { json: () => unknown }) => res.json() as Body;

  it('S1: POST answers 202 with the UUID, hasMore and nextCursor', async () => {
    build(3);
    const res = await post();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ id: analysisId(1), hasMore: false, nextCursor: null });
  });

  it('S2: hasMore and nextCursor when the filters match more than one page', async () => {
    build(5);
    const res = await post({ limit: 2 });
    expect(res.statusCode).toBe(202);
    expect(body(res).hasMore).toBe(true);
    expect(typeof body(res).nextCursor).toBe('string');
  });

  it('S3: invalid limit or unknown key is a 400 VALIDATION_ERROR', async () => {
    build(1);
    for (const payload of [{ limit: 201 }, { foo: 1 }]) {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('S4: no matching logs is a 422 NO_LOGS_TO_ANALYZE', async () => {
    build(0);
    const res = await post();
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'NO_LOGS_TO_ANALYZE' } });
    expect(await analysisRepo.findById(analysisId(1))).toBeNull();
  });

  it('S5: a second POST while one is PROCESSING is a 409 with the running id in details', async () => {
    build(2, hangUntilAborted);
    const first = await post();

    const res = await post();

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'ANALYSIS_IN_PROGRESS', details: { id: body(first).id } } });
  });

  it('S9: GET of a COMPLETED analysis returns findings, logIds and tokens without any rawResponse key', async () => {
    build(2, okJson({ summary: 'Resumen', findings: [{ category: 'DATABASE', severity: 'HIGH', description: 'd', suggestions: ['s'], logRefs: [1] }] }, { prompt: 9, completion: 4 }));
    const { id } = body(await post());
    await runner.idle();

    const res = await get(id);

    expect(res.statusCode).toBe(200);
    const json = body(res);
    expect(json).toMatchObject({
      id,
      status: 'COMPLETED',
      summary: 'Resumen',
      logCount: 2,
      provider: 'scripted',
      model: 'scripted-model',
      tokens: { prompt: 9, completion: 4 },
      error: null,
      createdAt: NOW.toISOString(),
    });
    expect(json.findings).toHaveLength(1);
    expect(json.findings[0]).toMatchObject({ id: expect.any(Number) as number, category: 'DATABASE', severity: 'HIGH', suggestions: ['s'], logIds: [makeListLog(2).id] });
    expect(JSON.stringify(json)).not.toMatch(/raw/i);
    expect(Object.keys(json).sort()).toEqual(
      ['createdAt', 'durationMs', 'error', 'findings', 'id', 'logCount', 'model', 'provider', 'status', 'summary', 'tokens'],
    );
  });

  it('S10: GET of a PROCESSING analysis has null summary and duration and no findings', async () => {
    build(1, hangUntilAborted);
    const { id } = body(await post());

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'PROCESSING', summary: null, findings: [], durationMs: null, tokens: null, error: null });
  });

  it('S11: GET of a FAILED analysis carries the error and the token usage the provider reported', async () => {
    build(1, { text: '{"summary":"x"}', usage: { prompt: 3, completion: 1 } });
    const { id } = body(await post());
    await runner.idle();

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'FAILED', error: { code: 'LLM_INVALID_RESPONSE' }, tokens: { prompt: 3, completion: 1 } });
  });

  it('S12: a non-UUID id is a 400 and an unknown UUID a 404', async () => {
    build(1);
    expect((await get('not-a-uuid')).statusCode).toBe(400);
    const res = await get(analysisId(99));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('S8: a missing, unknown or inactive key gives the same 401 on POST and GET', async () => {
    build(1);
    const bodies = new Set<string>();
    const wrongHeaders: Record<string, string>[] = [{}, { 'x-api-key': 'nope' }, { 'x-api-key': 'k-off' }];
    for (const h of wrongHeaders) {
      for (const res of [await post({}, h), await get(analysisId(1), h)]) {
        expect(res.statusCode).toBe(401);
        bodies.add(res.body);
      }
    }
    expect(bodies.size).toBe(1);
  });

  it('is documented in the OpenAPI spec', async () => {
    build(1);
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    const spec = res.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/logs/analyze', '/api/analysis/{id}']));
  });
});
