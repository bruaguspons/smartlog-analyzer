import { describe, expect, it } from 'vitest';
import { llmResponseSchema } from '@/modules/analysis/application/llm-response/llm-response.schema.js';

const validFinding = {
  category: 'DATABASE',
  severity: 'HIGH',
  description: 'Conexiones agotadas',
  suggestions: ['Increase the pool size'],
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
