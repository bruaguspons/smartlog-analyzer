import {
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  type FindingCategory,
  type FindingSeverity,
  type NewFinding,
} from '../domain/analysis.js';
import type { LlmResponse } from './llm-response-schema.js';

export interface NormalizedResponse {
  summary: string;
  findings: NewFinding[];
  warnings: string[];
}

function matchEnum<T extends string>(values: readonly T[], raw: string): T | undefined {
  const candidate = raw.trim().toUpperCase();
  return values.find((value) => value === candidate);
}

/**
 * A structurally valid response with odd content is tolerated. Unknown category -> OTHER,
 * unknown severity -> MEDIUM (warning), refs outside 1..N are dropped and valid ones mapped to log ids.
 * `logIds[i]` is the id of the log that was sent as number i + 1.
 */
export function normalizeLlmResponse(response: LlmResponse, logIds: readonly string[]): NormalizedResponse {
  const warnings: string[] = [];

  const findings = response.findings.map((raw): NewFinding => {
    let category: FindingCategory | undefined = matchEnum(FINDING_CATEGORIES, raw.category);
    if (!category) {
      warnings.push(`Unknown category "${raw.category}" replaced by OTHER`);
      category = 'OTHER';
    }
    let severity: FindingSeverity | undefined = matchEnum(FINDING_SEVERITIES, raw.severity);
    if (!severity) {
      warnings.push(`Unknown severity "${raw.severity}" replaced by MEDIUM`);
      severity = 'MEDIUM';
    }

    const mapped = new Set<string>();
    for (const ref of raw.logRefs) {
      const id = Number.isInteger(ref) ? logIds[ref - 1] : undefined;
      if (id !== undefined) mapped.add(id);
    }

    return {
      category,
      severity,
      description: raw.description,
      suggestions: raw.suggestions,
      logIds: [...mapped],
    };
  });

  return { summary: response.summary, findings, warnings };
}
