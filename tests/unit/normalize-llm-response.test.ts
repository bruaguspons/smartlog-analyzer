import { describe, expect, it } from 'vitest';
import { normalizeLlmResponse } from '../../src/modules/analysis/application/normalize-llm-response.js';

const ids = ['id-1', 'id-2', 'id-3'];

const finding = (overrides: Record<string, unknown> = {}) => ({
  category: 'DATABASE',
  severity: 'HIGH',
  description: 'desc',
  suggestions: ['s'],
  logRefs: [1],
  ...overrides,
});

const run = (findings: ReturnType<typeof finding>[]) =>
  normalizeLlmResponse({ summary: 'summary', findings }, ids);

describe('normalizeLlmResponse', () => {
  it('maps refs to log ids and keeps valid category and severity', () => {
    const result = run([finding({ logRefs: [1, 3] })]);
    expect(result.summary).toBe('summary');
    expect(result.findings).toEqual([
      { category: 'DATABASE', severity: 'HIGH', description: 'desc', suggestions: ['s'], logIds: ['id-1', 'id-3'] },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('maps an unknown category to OTHER', () => {
    expect(run([finding({ category: 'weird' })]).findings[0]?.category).toBe('OTHER');
  });

  it('maps an unknown severity to MEDIUM and warns with the original value', () => {
    const result = run([finding({ severity: 'SEVERE' })]);
    expect(result.findings[0]?.severity).toBe('MEDIUM');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('SEVERE');
  });

  it('matches category and severity after trim and uppercase', () => {
    const result = run([finding({ category: ' database ', severity: ' critical' })]);
    expect(result.findings[0]).toMatchObject({ category: 'DATABASE', severity: 'CRITICAL' });
    expect(result.warnings).toEqual([]);
  });

  it('drops refs outside 1..N, non-integers and duplicates', () => {
    const result = run([finding({ logRefs: [1, 99, 0, -1, 1.5, 1, 2] })]);
    expect(result.findings[0]?.logIds).toEqual(['id-1', 'id-2']);
  });

  it('keeps a finding left with no valid refs', () => {
    const result = run([finding({ logRefs: [99] })]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.logIds).toEqual([]);
  });

  it('accepts empty findings', () => {
    expect(run([]).findings).toEqual([]);
  });
});
