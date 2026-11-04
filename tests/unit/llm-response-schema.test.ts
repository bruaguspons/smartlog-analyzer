import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FINDING_CATEGORIES, FINDING_SEVERITIES } from '../../src/modules/analysis/domain/analysis.js';
import {
  llmResponseSchema,
  requestedResponseSchema,
} from '../../src/modules/analysis/application/llm-response-schema.js';

const validFinding = {
  category: 'DATABASE',
  severity: 'HIGH',
  description: 'Conexiones agotadas',
  suggestions: ['Aumentar el pool'],
  logRefs: [1, 2],
};

describe('llmResponseSchema (tolerant)', () => {
  it('accepts a well-formed response', () => {
    expect(llmResponseSchema.safeParse({ summary: 'ok', findings: [validFinding] }).success).toBe(true);
  });

  it('accepts empty findings', () => {
    expect(llmResponseSchema.safeParse({ summary: 'ok', findings: [] }).success).toBe(true);
  });

  it('accepts unknown category and severity strings (content is tolerated)', () => {
    const result = llmResponseSchema.safeParse({
      summary: 'ok',
      findings: [{ ...validFinding, category: 'weird', severity: 'SEVERE' }],
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['missing summary', { findings: [] }],
    ['missing findings', { summary: 'ok' }],
    ['summary wrong type', { summary: 1, findings: [] }],
    ['findings not an array', { summary: 'ok', findings: 'none' }],
    ['finding missing description', { summary: 'ok', findings: [{ ...validFinding, description: undefined }] }],
    ['suggestions wrong type', { summary: 'ok', findings: [{ ...validFinding, suggestions: 'x' }] }],
    ['logRefs wrong type', { summary: 'ok', findings: [{ ...validFinding, logRefs: ['1'] }] }],
    ['not an object', 'not json'],
  ])('rejects %s', (_name, value) => {
    expect(llmResponseSchema.safeParse(value).success).toBe(false);
  });
});

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
