import { NotFoundError } from '@/shared/errors/not-found-error.js';
import type { AnalysisView } from '@/modules/analysis/domain/analysis.types.js';
import type { AnalysisRepository } from '@/modules/analysis/domain/analysis-repository.types.js';

export async function getAnalysis(id: string, deps: { repo: AnalysisRepository }): Promise<AnalysisView> {
  const view = await deps.repo.findById(id);
  if (!view) throw new NotFoundError('Analysis not found');
  return view;
}
