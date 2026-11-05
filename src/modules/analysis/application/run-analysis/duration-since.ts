import type { AnalysisJob, ProcessDeps } from './process-analysis.types.js';

export function durationSince(job: AnalysisJob, deps: ProcessDeps): number {
  return Math.max(0, deps.now().getTime() - job.createdAt.getTime());
}
