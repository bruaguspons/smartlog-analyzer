import { describe, expect, it } from 'vitest';
import { analysisId } from '@tests/support/contracts/analysis-repository-contract.js';
import { hangUntilAborted, okJson } from '@tests/support/fakes/scripted-llm-client.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';
import { NOW, useAnalysisApp } from '@tests/support/apps/analysis-test-app.js';

describe('GET /api/analysis/:id', () => {
  const t = useAnalysisApp();
  const { build, post, get, body } = t;

  it('GET of a COMPLETED analysis returns findings, logIds and tokens without any rawResponse key', async () => {
    build(2, okJson({ summary: 'Summary', findings: [{ category: 'DATABASE', severity: 'HIGH', description: 'd', suggestions: ['s'], logRefs: [1] }] }, { prompt: 9, completion: 4 }));
    const { id } = body(await post());
    await t.runner.idle();

    const res = await get(id);

    expect(res.statusCode).toBe(200);
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
    // raw_response readback is covered in tests/integration/analysis-http.test.ts.
    expect(Object.keys(json).sort()).toEqual(
      ['createdAt', 'durationMs', 'error', 'findings', 'id', 'logCount', 'model', 'provider', 'status', 'summary', 'tokens'],
    );
  });

  it('GET of a PROCESSING analysis has null summary and duration and no findings', async () => {
    build(1, hangUntilAborted);
    const { id } = body(await post());

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'PROCESSING', summary: null, findings: [], durationMs: null, tokens: null, error: null });
  });

  it('GET of a FAILED analysis carries the error and the token usage the provider reported', async () => {
    build(1, { text: '{"summary":"x"}', usage: { prompt: 3, completion: 1 } });
    const { id } = body(await post());
    await t.runner.idle();

    const json = body(await get(id));

    expect(json).toMatchObject({ status: 'FAILED', error: { code: 'LLM_INVALID_RESPONSE' }, tokens: { prompt: 3, completion: 1 } });
  });

  it('a non-UUID id is a 400 and an unknown UUID a 404', async () => {
    build(1);
    expect((await get('not-a-uuid')).statusCode).toBe(400);
    const res = await get(analysisId(99));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

});
