import type { NewFinding } from '@/models/analysis.js';

export interface NormalizedResponse {
  summary: string;
  findings: NewFinding[];
  warnings: string[];
}
