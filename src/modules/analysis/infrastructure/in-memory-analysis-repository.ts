import type { AnalysisView, FindingView, NewAnalysis } from '../domain/analysis.js';
import type {
  AnalysisRepository,
  CompleteInput,
  CreateProcessingOutcome,
  FailInput,
} from '../domain/analysis-repository.js';

type Stored = Omit<AnalysisView, 'logCount' | 'findings'> & { logIds: string[]; findings: FindingView[] };

/** Test double that emulates the store's single-PROCESSING rule and compare-and-set transitions. */
export class InMemoryAnalysisRepository implements AnalysisRepository {
  private readonly rows = new Map<string, Stored>();
  private nextFindingId = 1;

  createProcessing(analysis: NewAnalysis, logIds: readonly string[]): Promise<CreateProcessingOutcome> {
    const running = [...this.rows.values()].find((row) => row.status === 'PROCESSING');
    if (running) return Promise.resolve({ created: false, runningId: running.id });
    this.rows.set(analysis.id, {
      ...analysis,
      status: 'PROCESSING',
      durationMs: null,
      summary: null,
      tokens: null,
      error: null,
      findings: [],
      logIds: [...logIds],
    });
    return Promise.resolve({ created: true });
  }

  complete(id: string, input: CompleteInput): Promise<boolean> {
    const row = this.rows.get(id);
    if (row?.status !== 'PROCESSING') return Promise.resolve(false);
    const allowed = new Set(row.logIds);
    if (input.findings.some((f) => f.logIds.some((logId) => !allowed.has(logId)))) {
      return Promise.reject(new Error('A finding references a log outside the analysis'));
    }
    row.status = 'COMPLETED';
    row.summary = input.summary;
    row.tokens = input.usage;
    row.durationMs = input.durationMs;
    row.findings = input.findings.map((f) => ({ ...f, id: this.nextFindingId++ }));
    return Promise.resolve(true);
  }

  fail(id: string, input: FailInput): Promise<boolean> {
    const row = this.rows.get(id);
    if (row?.status !== 'PROCESSING') return Promise.resolve(false);
    row.status = 'FAILED';
    row.error = { code: input.errorCode, message: input.errorMessage };
    row.tokens = input.usage;
    row.durationMs = input.durationMs;
    return Promise.resolve(true);
  }

  failAllProcessing(input: { errorCode: 'INTERRUPTED'; errorMessage: string }): Promise<string[]> {
    const ids: string[] = [];
    for (const row of this.rows.values()) {
      if (row.status !== 'PROCESSING') continue;
      row.status = 'FAILED';
      row.error = { code: input.errorCode, message: input.errorMessage };
      ids.push(row.id);
    }
    return Promise.resolve(ids);
  }

  findById(id: string): Promise<AnalysisView | null> {
    const row = this.rows.get(id);
    if (!row) return Promise.resolve(null);
    const { logIds, ...view } = row;
    return Promise.resolve({ ...view, logCount: logIds.length });
  }
}
