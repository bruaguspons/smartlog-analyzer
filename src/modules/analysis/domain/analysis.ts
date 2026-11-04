export const ANALYSIS_STATUSES = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Closed set of persisted failure codes, documented in ARCHITECTURE.md under "Llamada al LLM"; stored as a plain string in the database. */
export const ANALYSIS_ERROR_CODES = [
  'LLM_TIMEOUT',
  'LLM_RATE_LIMITED',
  'LLM_UNAVAILABLE',
  'LLM_REQUEST_REJECTED',
  'LLM_INVALID_RESPONSE',
  'INTERRUPTED',
  'INTERNAL_ERROR',
] as const;
export type AnalysisErrorCode = (typeof ANALYSIS_ERROR_CODES)[number];

export const FINDING_CATEGORIES = [
  'DATABASE',
  'NETWORK',
  'TIMEOUT',
  'EXTERNAL_DEPENDENCY',
  'AUTHENTICATION',
  'VALIDATION',
  'RESOURCE_EXHAUSTION',
  'PERFORMANCE',
  'CONFIGURATION',
  'APPLICATION_ERROR',
  'SECURITY',
  'DATA_INTEGRITY',
  'OTHER',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const FINDING_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface TokenUsage {
  prompt: number;
  completion: number;
}

/** Input to create an analysis; the id is a UUIDv7 assigned by the application. */
export interface NewAnalysis {
  id: string;
  provider: string;
  model: string;
  createdAt: Date;
}

export interface NewFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  description: string;
  suggestions: string[];
  /** Must be a subset of the analysis's logs. */
  logIds: string[];
}

export interface FindingView extends NewFinding {
  id: number;
}

/** Read model of an analysis; the raw LLM response is never part of it. */
export interface AnalysisView {
  id: string;
  status: AnalysisStatus;
  createdAt: Date;
  /** Null while PROCESSING and for rows closed by startup recovery (the real duration is unknown). */
  durationMs: number | null;
  /** Derived from the analysis's logs. */
  logCount: number;
  provider: string;
  model: string;
  summary: string | null;
  findings: FindingView[];
  tokens: TokenUsage | null;
  error: { code: AnalysisErrorCode; message: string } | null;
}
