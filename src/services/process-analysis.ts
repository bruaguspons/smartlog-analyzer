import { callLlmWithRetry, LlmCallFailure, type RetryDeps } from '@/llm/call-llm-with-retry.js';
import type { LlmClient } from '@/llm/llm-client.js';
import { llmResponseSchema } from '@/llm/llm-response.js';
import { normalizeLlmResponse } from '@/llm/normalize-llm-response.js';
import { buildPrompt } from '@/llm/prompt.js';
import type { AnalysisErrorCode, TokenUsage } from '@/models/analysis.js';
import type { Log } from '@/models/log.js';
import type { AnalysisRepository } from '@/repositories/analysis.repository.js';

/** Minimal logger the job needs; the request logger satisfies it, so job logs carry the `reqId`. */
export interface JobLog {
  info(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface AnalysisJob {
  analysisId: string;
  logs: readonly Log[];
  createdAt: Date;
}

export interface ProcessDeps {
  repo: AnalysisRepository;
  llm: LlmClient;
  policy: { timeoutMs: number; maxRetries: number };
  now: () => Date;
  /** Test seam: deterministic time and randomness for the retry policy. */
  retry?: Partial<RetryDeps>;
}

/** What the provider returned before processing broke down; kept so the last-resort write can still persist it. */
export interface PartialOutcome {
  rawResponse: string | null;
  usage: TokenUsage | null;
}

/** Persisted messages are fixed text: provider error text may echo request details such as keys. */
const INTERNAL_MESSAGE = 'Internal error while processing the analysis';
const INVALID_RESPONSE_MESSAGE = 'The model response did not match the expected structure';
const INTERRUPTED_MESSAGE = 'Analysis interrupted by server shutdown';

/** Thrown when a failure after the model answered could not be recorded; carries the answer for the runner's retry. */
export class AnalysisProcessingError extends Error {
  readonly partial: PartialOutcome;

  constructor(partial: PartialOutcome, cause: unknown) {
    super('analysis processing failed and the failure could not be recorded', { cause });
    this.name = 'AnalysisProcessingError';
    this.partial = partial;
  }
}

function durationSince(job: AnalysisJob, deps: ProcessDeps): number {
  return Math.max(0, deps.now().getTime() - job.createdAt.getTime());
}

const NO_OUTCOME: PartialOutcome = { rawResponse: null, usage: null };

/** Compare-and-set to FAILED with the elapsed time; false when another writer already closed the analysis. */
function recordFailure(
  job: AnalysisJob,
  deps: ProcessDeps,
  errorCode: AnalysisErrorCode,
  errorMessage: string,
  partial: PartialOutcome = NO_OUTCOME,
): Promise<boolean> {
  return deps.repo.fail(job.analysisId, { errorCode, errorMessage, ...partial, durationMs: durationSince(job, deps) });
}

/** Compare-and-set to FAILED/INTERNAL_ERROR; also the last-resort write of the runner's `finally`. */
export function markInternalError(
  job: AnalysisJob,
  deps: ProcessDeps,
  partial: PartialOutcome = NO_OUTCOME,
): Promise<boolean> {
  return recordFailure(job, deps, 'INTERNAL_ERROR', INTERNAL_MESSAGE, partial);
}

function parseResponse(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = llmResponseSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Runs one analysis: prompt -> LLM call with retries -> validate -> normalize -> terminal write.
 * Every outcome it can classify is written here; anything it cannot is thrown for the runner's `finally`.
 */
export async function processAnalysis(
  job: AnalysisJob,
  deps: ProcessDeps,
  signal: AbortSignal,
  log: JobLog,
): Promise<void> {
  const request = buildPrompt(job.logs);

  let result;
  try {
    result = await callLlmWithRetry(
      (attemptSignal) => deps.llm.generate(request, attemptSignal),
      { ...deps.policy, signal },
      deps.retry,
    );
  } catch (error) {
    if (!(error instanceof LlmCallFailure)) throw error;
    const errorCode: AnalysisErrorCode = error.code;
    await recordFailure(job, deps, errorCode, errorCode === 'INTERRUPTED' ? INTERRUPTED_MESSAGE : error.message);
    return;
  }

  const { text: rawResponse, usage } = result;
  try {
    const response = parseResponse(rawResponse);
    if (!response) {
      await recordFailure(job, deps, 'LLM_INVALID_RESPONSE', INVALID_RESPONSE_MESSAGE, { rawResponse, usage });
      return;
    }

    const { summary, findings, warnings } = normalizeLlmResponse(
      response,
      job.logs.map((l) => l.id),
    );
    for (const warning of warnings) log.warn({ analysisId: job.analysisId }, warning);

    await deps.repo.complete(job.analysisId, {
      summary,
      findings,
      rawResponse,
      usage,
      durationMs: durationSince(job, deps),
    });
  } catch (error) {
    log.error({ err: error, analysisId: job.analysisId }, 'analysis processing failed');
    // Keep what the provider returned: the raw answer and token usage are worth having even on failure.
    try {
      await markInternalError(job, deps, { rawResponse, usage });
    } catch (writeError) {
      throw new AnalysisProcessingError({ rawResponse, usage }, writeError);
    }
  }
}
