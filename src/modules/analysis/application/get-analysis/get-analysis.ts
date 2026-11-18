import { NotFoundError } from '@/shared/errors/not-found-error.js';
import type { AnalysisView } from '@/models/analysis.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';

export async function getAnalysis(id: string, deps: { repo: AnalysisRepository }): Promise<AnalysisView> {
  const view = await deps.repo.findById(id);
  if (!view) throw new NotFoundError('Analysis not found');
  return view;
}
