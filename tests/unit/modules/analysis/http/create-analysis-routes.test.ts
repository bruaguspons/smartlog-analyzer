import { describe, expect, it } from 'vitest';
import { analysisId } from '@tests/support/contracts/analysis-repository-contract.js';
import { useAnalysisApp } from '@tests/support/apps/analysis-test-app.js';

describe('analysis routes', () => {
  const t = useAnalysisApp();
  const { build, post, get } = t;

  it('a missing, unknown or inactive key gives the same 401 on POST and GET', async () => {
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
    const res = await t.app.inject({ method: 'GET', url: '/docs/json' });
    const spec = res.json<{ paths: Record<string, unknown> }>();
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/api/logs/analyze', '/api/analysis/{id}']));
  });
});
