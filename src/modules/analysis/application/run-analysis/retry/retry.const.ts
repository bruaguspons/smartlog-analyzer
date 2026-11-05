import type { AnalysisErrorCode } from '@/modules/analysis/domain/analysis.types.js';
import type { FailureKind } from './retry.types.js';

export const CODE_BY_KIND: Record<FailureKind, AnalysisErrorCode> = {
  timeout: 'LLM_TIMEOUT',
  rate_limited: 'LLM_RATE_LIMITED',
  network: 'LLM_UNAVAILABLE',
  unavailable: 'LLM_UNAVAILABLE',
  rejected: 'LLM_REQUEST_REJECTED',
};
