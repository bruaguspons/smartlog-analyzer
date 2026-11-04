import type { LlmClient, LlmRequest, LlmResult } from '../../src/modules/analysis/domain/llm-client.js';

export type ScriptStep =
  | LlmResult
  | Error
  | ((request: LlmRequest, signal: AbortSignal) => Promise<LlmResult>);

/**
 * Test double: replays a fixed script, one step per call (the last step repeats).
 * A step is a result, an error to throw, or a function for custom behavior (e.g. hang until aborted).
 */
export class ScriptedLlmClient implements LlmClient {
  readonly provider = 'scripted';
  readonly model = 'scripted-model';
  readonly requests: LlmRequest[] = [];
  private readonly script: readonly ScriptStep[];

  constructor(...script: ScriptStep[]) {
    if (script.length === 0) throw new Error('ScriptedLlmClient needs at least one step');
    this.script = script;
  }

  get calls(): number {
    return this.requests.length;
  }

  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResult> {
    const index = Math.min(this.requests.length, this.script.length - 1);
    this.requests.push(request);
    const step = this.script[index] as ScriptStep;
    if (step instanceof Error) return Promise.reject(step);
    if (typeof step === 'function') return step(request, signal);
    return Promise.resolve(step);
  }
}

/** Resolves a JSON string as a successful model answer. */
export const okJson = (value: unknown, usage = { prompt: 10, completion: 5 }): LlmResult => ({
  text: JSON.stringify(value),
  usage,
});

/** A step that never settles on its own and rejects when the signal aborts. */
export const hangUntilAborted: ScriptStep = (_request, signal) =>
  new Promise<LlmResult>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
