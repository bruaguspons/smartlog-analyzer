import type { AnalysisErrorCode } from '@/modules/analysis/domain/analysis.types.js';
import type { JobLog } from '@/modules/analysis/domain/job-log.types.js';
import { llmResponseSchema } from '@/modules/analysis/application/llm-response/llm-response.schema.js';
import { normalizeLlmResponse } from '@/modules/analysis/application/llm-response/normalize-llm-response.js';
import { buildPrompt } from '@/modules/analysis/application/run-analysis/prompt/build-prompt.js';
import { callWithRetry } from '@/modules/analysis/application/run-analysis/retry/call-with-retry.js';
import { LlmCallFailure } from '@/modules/analysis/application/run-analysis/retry/llm-call-failure.js';
import { AnalysisProcessingError } from './analysis-processing-error.js';
import { durationSince } from './duration-since.js';
import { markInternalError } from './mark-internal-error.js';
import { INTERRUPTED_MESSAGE, INVALID_RESPONSE_MESSAGE } from './process-analysis.const.js';
import type { AnalysisJob, ProcessDeps } from './process-analysis.types.js';

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
    result = await callWithRetry(
      (attemptSignal) => deps.llm.generate(request, attemptSignal),
      { ...deps.policy, signal },
      deps.retry,
    );
  } catch (error) {
    if (!(error instanceof LlmCallFailure)) throw error;
    const errorCode: AnalysisErrorCode = error.code;
    await deps.repo.fail(job.analysisId, {
      errorCode,
      errorMessage: errorCode === 'INTERRUPTED' ? INTERRUPTED_MESSAGE : error.message,
      rawResponse: null,
      usage: null,
      durationMs: durationSince(job, deps),
    });
    return;
  }

  const { text: rawResponse, usage } = result;
  try {
    const response = parseResponse(rawResponse);
    if (!response) {
      await deps.repo.fail(job.analysisId, {
        errorCode: 'LLM_INVALID_RESPONSE',
        errorMessage: INVALID_RESPONSE_MESSAGE,
        rawResponse,
        usage,
        durationMs: durationSince(job, deps),
      });
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
