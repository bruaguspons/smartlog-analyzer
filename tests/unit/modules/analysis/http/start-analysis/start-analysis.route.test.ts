import { describe, expect, it } from 'vitest';
import { analysisId } from '@tests/support/contracts/analysis-repository-contract.js';
import { hangUntilAborted } from '@tests/support/fakes/scripted-llm-client.js';
import { useAnalysisApp } from '@tests/support/apps/analysis-test-app.js';

describe('POST /api/logs/analyze', () => {
  const t = useAnalysisApp();
  const { build, post, body } = t;

  it('POST answers 202 with the UUID, hasMore and nextCursor', async () => {
    build(3);
    const res = await post();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ id: analysisId(1), hasMore: false, nextCursor: null });
  });

  it('hasMore and nextCursor when the filters match more than one page', async () => {
    build(5);
    const res = await post({ limit: 2 });
    expect(res.statusCode).toBe(202);
    expect(body(res).hasMore).toBe(true);
    expect(typeof body(res).nextCursor).toBe('string');
  });

  it('invalid limit or unknown key is a 400 VALIDATION_ERROR', async () => {
    build(1);
    for (const payload of [{ limit: 201 }, { foo: 1 }]) {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    }
  });

  it('no matching logs is a 422 NO_LOGS_TO_ANALYZE', async () => {
    build(0);
    const res = await post();
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'NO_LOGS_TO_ANALYZE' } });
    expect(await t.analysisRepo.findById(analysisId(1))).toBeNull();
  });

  it('a second POST while one is PROCESSING is a 409 with the running id in details', async () => {
    build(2, hangUntilAborted);
    const first = await post();

    const res = await post();

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'ANALYSIS_IN_PROGRESS', details: { id: body(first).id } } });
  });

});
