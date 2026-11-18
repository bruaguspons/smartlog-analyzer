import type { LlmClient, LlmRequest, LlmResult } from '@/llm/llm-client.js';

export type ScriptStep =
  | LlmResult
  | Error
  | ((request: LlmRequest, signal: AbortSignal) => Promise<LlmResult>);

/**
 * Test double: replays a fixed script, one step per call (the last step repeats).
 * A step is a result, an error to throw, or a function for custom behavior (e.g. hang until aborted).
 * One instance can serve a whole test file: `reset` swaps the script and `releaseHanging` frees stuck calls.
 */
export class ScriptedLlmClient implements LlmClient {
  readonly provider = 'scripted';
  readonly model = 'scripted-model';
  readonly requests: LlmRequest[] = [];
  private script: readonly ScriptStep[];
  private release = new AbortController();

  constructor(...script: ScriptStep[]) {
    this.script = script;
  }

  get calls(): number {
    return this.requests.length;
  }

  /** Replaces the script and forgets the recorded requests. */
  reset(...script: ScriptStep[]): void {
    this.script = script;
    this.requests.length = 0;
  }

  /** Aborts the signal every in-flight call received, so steps such as `hangUntilAborted` settle. */
  releaseHanging(): void {
    this.release.abort(new Error('Hanging call released by the test'));
    this.release = new AbortController();
  }

  generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResult> {
    if (this.script.length === 0) throw new Error('ScriptedLlmClient has no script: pass steps or call reset()');
    const index = Math.min(this.requests.length, this.script.length - 1);
    this.requests.push(request);
    const step = this.script[index] as ScriptStep;
    if (step instanceof Error) return Promise.reject(step);
    if (typeof step === 'function') return step(request, AbortSignal.any([signal, this.release.signal]));
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
