import type { LlmClient, LlmRequest, LlmResult } from '../../domain/llm-client.js';
import type { LlmResponse } from '../../application/llm-response-schema.js';

export type MockBehavior = 'normal' | 'invalid' | 'timeout';

export interface MockClientOptions {
  /** `invalid` answers with non-JSON; `timeout` hangs until the signal aborts. Default `normal`. */
  behavior?: MockBehavior;
}

const GROUPS = [
  { level: 'ERROR', severity: 'HIGH', label: 'errores' },
  { level: 'FATAL', severity: 'CRITICAL', label: 'errores fatales' },
] as const;

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
    const text = this.behavior === 'invalid' ? 'respuesta simulada que no es JSON' : JSON.stringify(this.respond(request));
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
        description: `Se detectaron ${String(refs.length)} logs con nivel ${group.level} (${group.label}) en el lote.`,
        suggestions: ['Revisar la traza de los logs indicados y corregir la causa raíz.'],
        logRefs: refs,
      });
    }
    return {
      summary: `Se analizaron ${String(request.entries.length)} logs y se identificaron ${String(findings.length)} grupos de errores (análisis simulado).`,
      findings,
    };
  }
}
