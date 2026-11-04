import { NotFoundError } from '../../../shared/errors/app-error.js';
import type { AnalysisView } from '../domain/analysis.js';
import type { AnalysisRepository } from '../domain/analysis-repository.js';

export async function getAnalysis(id: string, deps: { repo: AnalysisRepository }): Promise<AnalysisView> {
  const view = await deps.repo.findById(id);
  if (!view) throw new NotFoundError('Analysis not found');
  return view;
}
