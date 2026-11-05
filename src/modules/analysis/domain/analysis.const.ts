export const ANALYSIS_STATUSES = ['PROCESSING', 'COMPLETED', 'FAILED'] as const;

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

export const FINDING_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
