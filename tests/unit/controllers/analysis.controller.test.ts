import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NOW, useAnalysisApp } from '@tests/support/apps/analysis-express-app.js';
import { analysisId } from '@tests/support/contracts/analysis-repository-contract.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';
import { hangUntilAborted, okJson } from '@tests/support/fakes/scripted-llm-client.js';

describe('POST /api/logs/analyze', () => {
  const t = useAnalysisApp();
  const { build, post, body } = t;

  it('answers 202 with the UUID, hasMore and nextCursor', async () => {
    build(3);
    const res = await post();
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: analysisId(1), hasMore: false, nextCursor: null });
  });

  it('hasMore and nextCursor when the filters match more than one page', async () => {
    build(5);
    const res = await post({ limit: 2 });
    expect(res.status).toBe(202);
    expect(body(res).hasMore).toBe(true);
    expect(typeof body(res).nextCursor).toBe('string');
  });

  it('invalid limit or unknown key is a 400 VALIDATION_ERROR', async () => {
    build(1);
    for (const payload of [{ limit: 201 }, { foo: 1 }]) {
      const res = await post(payload);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('no matching logs is a 422 NO_LOGS_TO_ANALYZE', async () => {
    build(0);
    const res = await post();
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ error: { code: 'NO_LOGS_TO_ANALYZE' } });
    expect(await t.analysisRepo.findById(analysisId(1))).toBeNull();
  });

  it('a second POST while one is PROCESSING is a 409 with the running id in details', async () => {
    build(2, hangUntilAborted);
    const first = await post();

    const res = await post();

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ error: { code: 'ANALYSIS_IN_PROGRESS', details: { id: body(first).id } } });
  });

});

describe('GET /api/analysis/:id', () => {
  const t = useAnalysisApp();
  const { build, post, get, body } = t;

  it('a COMPLETED analysis returns findings, logIds and tokens without any rawResponse key', async () => {
    build(2, okJson({ summary: 'Summary', findings: [{ category: 'DATABASE', severity: 'HIGH', description: 'd', suggestions: ['s'], logRefs: [1] }] }, { prompt: 9, completion: 4 }));
    const { id } = body(await post());
    await t.runner.idle();

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
    expect(json.findings).toHaveLength(1);
    expect(json.findings[0]).toMatchObject({ id: expect.any(Number) as number, category: 'DATABASE', severity: 'HIGH', suggestions: ['s'], logIds: [makeListLog(2).id] });
    // The exact key set is the contract. The in-memory view has no raw response to leak; the Postgres
    // raw_response readback is covered in the integration tests.
    expect(Object.keys(json).sort()).toEqual(
      ['createdAt', 'durationMs', 'error', 'findings', 'id', 'logCount', 'model', 'provider', 'status', 'summary', 'tokens'],
    );
  });

  it('a PROCESSING analysis has null summary and duration and no findings', async () => {
    build(1, hangUntilAborted);
    const { id } = body(await post());

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'PROCESSING', summary: null, findings: [], durationMs: null, tokens: null, error: null });
  });

  it('a FAILED analysis carries the error and the token usage the provider reported', async () => {
    build(1, { text: '{"summary":"x"}', usage: { prompt: 3, completion: 1 } });
    const { id } = body(await post());
    await t.runner.idle();

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'FAILED', error: { code: 'LLM_INVALID_RESPONSE' }, tokens: { prompt: 3, completion: 1 } });
  });

  it('a non-UUID id is a 400 and an unknown UUID a 404', async () => {
    build(1);
    expect((await get('not-a-uuid')).status).toBe(400);
    const res = await get(analysisId(99));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('analysis authentication', () => {
  const t = useAnalysisApp();

  it('a missing, unknown or inactive key gives the same 401 on POST and GET', async () => {
    t.build(1);
    const bodies = new Set<string>();
    const wrongHeaders: Record<string, string>[] = [{}, { 'x-api-key': 'nope' }, { 'x-api-key': 'k-off' }];
    for (const h of wrongHeaders) {
      for (const res of [await t.post({}, h), await t.get(analysisId(1), h)]) {
        expect(res.status).toBe(401);
        bodies.add(res.text);
      }
    }
    expect(bodies.size).toBe(1);
  });

  it('is documented in the OpenAPI document', async () => {
    t.build(1);
    const res = await request(t.app).get('/docs/json');
    expect(Object.keys((res.body as { paths: object }).paths)).toEqual(expect.arrayContaining(['/api/logs/analyze', '/api/analysis/{id}']));
  });
});
