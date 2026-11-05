import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from '@/modules/analysis/domain/analysis.const.js';
import { requestedResponseSchema } from '@/modules/analysis/application/llm-response/requested-response.schema.js';

describe('requestedResponseSchema (sent to the model)', () => {
  it('exposes category and severity as enums in the JSON schema', () => {
    const json = z.toJSONSchema(requestedResponseSchema) as unknown as {
      properties: { findings: { items: { properties: Record<string, { enum?: string[] }> } } };
    };
    const props = json.properties.findings.items.properties;
    expect(props.category?.enum).toEqual([...FINDING_CATEGORIES]);
    expect(props.severity?.enum).toEqual([...FINDING_SEVERITIES]);
  });
});
