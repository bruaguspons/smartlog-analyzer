import type { AnalysisErrorCode, AnalysisView } from '@/modules/analysis/domain/analysis.types.js';
import type { AnalysisRow } from './analysis-row.types.js';

export function toAnalysisView(row: AnalysisRow): AnalysisView {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    durationMs: row.durationMs,
    logCount: row._count.logs,
    provider: row.provider,
    model: row.model,
    summary: row.summary,
    findings: row.findings.map((f) => ({
      id: f.id,
      category: f.category,
      severity: f.severity,
      description: f.description,
      // Written only by this repository from a validated string[], so the narrow cast is safe.
      suggestions: f.suggestions as string[],
      logIds: f.logs.map((l) => l.logId),
    })),
    tokens:
      row.promptTokens !== null && row.completionTokens !== null
        ? { prompt: row.promptTokens, completion: row.completionTokens }
        : null,
    error:
      row.errorCode !== null
        ? // Written only by this repository from the AnalysisErrorCode union.
          { code: row.errorCode as AnalysisErrorCode, message: row.errorMessage ?? '' }
        : null,
  };
}
