import type { NewFinding } from '@/modules/analysis/domain/analysis.types.js';

export interface NormalizedResponse {
  summary: string;
  findings: NewFinding[];
  warnings: string[];
}
