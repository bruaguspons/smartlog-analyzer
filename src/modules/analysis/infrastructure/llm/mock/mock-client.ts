import type { LlmClient, LlmRequest, LlmResult } from '@/modules/analysis/domain/llm-client.types.js';
import type { LlmResponse } from '@/modules/analysis/application/llm-response/llm-response.types.js';
import { GROUPS } from './mock-client.const.js';
import type { MockBehavior, MockClientOptions } from './mock-client.types.js';

const estimateTokens = (chars: number) => Math.ceil(chars / 4);

/** Deterministic offline client: derives its answer from the received logs, no randomness or clock. */
export class MockClient implements LlmClient {
  readonly provider = 'mock';
  readonly model = 'mock';
  private readonly behavior: MockBehavior;

  constructor(options: MockClientOptions = {}) {
    this.behavior = options.behavior ?? 'normal';
  }

  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResult> {
    if (signal.aborted) return Promise.reject(signal.reason as Error);
    if (this.behavior === 'timeout') {
      return new Promise<LlmResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      });
    }
    const text = this.behavior === 'invalid' ? 'simulated response that is not JSON' : JSON.stringify(this.respond(request));
    return Promise.resolve({
      text,
      usage: {
        prompt: estimateTokens(request.systemInstruction.length + request.prompt.length),
        completion: estimateTokens(text.length),
      },
    });
  }

  private respond(request: LlmRequest): LlmResponse {
    const findings: LlmResponse['findings'] = [];
    for (const group of GROUPS) {
      const refs = request.entries.filter((entry) => entry.log.level === group.level).map((entry) => entry.ref);
      if (refs.length === 0) continue;
      findings.push({
        category: 'APPLICATION_ERROR',
        severity: group.severity,
        description: `Detected ${String(refs.length)} logs with level ${group.level} (${group.label}) in the batch.`,
        suggestions: ['Review the trace of the listed logs and fix the root cause.'],
        logRefs: refs,
      });
    }
    return {
      summary: `Analyzed ${String(request.entries.length)} logs and identified ${String(findings.length)} error groups (simulated analysis).`,
      findings,
    };
  }
}
