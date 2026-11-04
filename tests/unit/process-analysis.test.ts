import { describe, expect, it, vi, type Mock } from 'vitest';
import { processAnalysis, type AnalysisJob } from '../../src/modules/analysis/application/process-analysis.js';
import { LlmError } from '../../src/modules/analysis/domain/llm-client.js';
import { InMemoryAnalysisRepository } from '../../src/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { analysisId } from '../shared/analysis-repository-contract.js';
import { makeListLog } from '../shared/log-repository-list-contract.js';
import { hangUntilAborted, okJson, ScriptedLlmClient } from '../shared/scripted-llm-client.js';

const CREATED_AT = new Date('2026-11-04T10:00:00.000Z');
const FINISHED_AT = new Date('2026-11-04T10:00:02.500Z');
const logs = [makeListLog(1), makeListLog(2), makeListLog(3)];
const job: AnalysisJob = { analysisId: analysisId(1), logs, createdAt: CREATED_AT };

const finding = (overrides: Record<string, unknown> = {}) => ({
  category: 'DATABASE',
  severity: 'HIGH',
  description: 'Pool exhausted',
  suggestions: ['Increase the pool'],
  logRefs: [1, 2],
  ...overrides,
});

type LogFn = Mock<(obj: object, msg: string) => void>;

function silentLog(): Record<'info' | 'warn' | 'error', LogFn> {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function setup(llm: ScriptedLlmClient, maxRetries = 0) {
  const repo = new InMemoryAnalysisRepository();
  await repo.createProcessing(
    { id: job.analysisId, provider: llm.provider, model: llm.model, createdAt: CREATED_AT },
    logs.map((l) => l.id),
  );
  const log = silentLog();
  const deps = { repo, llm, policy: { timeoutMs: 30_000, maxRetries }, now: () => FINISHED_AT };
  const run = (signal: AbortSignal = new AbortController().signal) => processAnalysis(job, deps, signal, log);
  return { repo, log, run, fail: vi.spyOn(repo, 'fail'), complete: vi.spyOn(repo, 'complete') };
}

describe('processAnalysis', () => {
  it('a valid response completes the analysis with findings mapped to log ids', async () => {
    const llm = new ScriptedLlmClient(okJson({ summary: 'Summary', findings: [finding()] }, { prompt: 11, completion: 7 }));
    const { repo, run, complete } = await setup(llm);

    await run();

    const view = await repo.findById(job.analysisId);
    expect(view).toMatchObject({
      status: 'COMPLETED',
      summary: 'Summary',
      tokens: { prompt: 11, completion: 7 },
      durationMs: 2500,
      error: null,
    });
    expect(view?.findings).toMatchObject([{ category: 'DATABASE', severity: 'HIGH', logIds: [logs[0]?.id, logs[1]?.id] }]);
    expect(complete.mock.calls[0]?.[1].rawResponse).toContain('Summary');
  });

  it('sends the prompt built from the batch to the model', async () => {
    const llm = new ScriptedLlmClient(okJson({ summary: 's', findings: [] }));
    const { run } = await setup(llm);
    await run();
    expect(llm.requests[0]?.entries.map((e) => e.ref)).toEqual([1, 2, 3]);
  });

  it('an empty findings list completes with zero findings', async () => {
    const { repo, run } = await setup(new ScriptedLlmClient(okJson({ summary: 'All good', findings: [] })));
    await run();
    expect(await repo.findById(job.analysisId)).toMatchObject({ status: 'COMPLETED', findings: [] });
  });

  it('an invalid structure fails once, keeping the raw response and token usage', async () => {
    const llm = new ScriptedLlmClient(okJson({ summary: 'x' }, { prompt: 40, completion: 3 }));
    const { repo, run, fail } = await setup(llm, 3);

    await run();

    expect(llm.calls).toBe(1);
    expect(await repo.findById(job.analysisId)).toMatchObject({
      status: 'FAILED',
      error: { code: 'LLM_INVALID_RESPONSE' },
      tokens: { prompt: 40, completion: 3 },
    });
    expect(fail.mock.calls[0]?.[1]).toMatchObject({ rawResponse: '{"summary":"x"}' });
  });

  it('a non-JSON answer fails with LLM_INVALID_RESPONSE and its raw text', async () => {
    const { repo, run, fail } = await setup(new ScriptedLlmClient({ text: 'not json', usage: null }));
    await run();
    expect(await repo.findById(job.analysisId)).toMatchObject({ status: 'FAILED', error: { code: 'LLM_INVALID_RESPONSE' } });
    expect(fail.mock.calls[0]?.[1]).toMatchObject({ rawResponse: 'not json', usage: null });
  });

  it('refs outside the batch are dropped and never reach the repository', async () => {
    const llm = new ScriptedLlmClient(okJson({ summary: 's', findings: [finding({ logRefs: [1, 99] })] }));
    const { repo, run } = await setup(llm);
    await run();
    const view = await repo.findById(job.analysisId);
    expect(view?.findings[0]?.logIds).toEqual([logs[0]?.id]);
  });

  it('odd category and severity are normalized and warned about', async () => {
    const llm = new ScriptedLlmClient(okJson({ summary: 's', findings: [finding({ category: 'weird', severity: 'SEVERE' })] }));
    const { repo, run, log } = await setup(llm);
    await run();
    expect((await repo.findById(job.analysisId))?.findings[0]).toMatchObject({ category: 'OTHER', severity: 'MEDIUM' });
    const warned = JSON.stringify(log.warn.mock.calls);
    expect(warned).toContain('weird');
    expect(warned).toContain('SEVERE');
  });

  it('an unexpected client error is rethrown untouched for the runner to close as INTERNAL_ERROR', async () => {
    const { run } = await setup(new ScriptedLlmClient(new TypeError('boom')));
    await expect(run()).rejects.toThrow(TypeError);
  });

  it('a failing completion leaves no findings, ends FAILED/INTERNAL_ERROR and keeps raw + tokens', async () => {
    const llm = new ScriptedLlmClient(okJson({ summary: 's', findings: [finding()] }, { prompt: 5, completion: 6 }));
    const { repo, run, complete, fail } = await setup(llm);
    complete.mockRejectedValueOnce(new Error('connection lost'));

    await run();

    expect(await repo.findById(job.analysisId)).toMatchObject({
      status: 'FAILED',
      error: { code: 'INTERNAL_ERROR' },
      findings: [],
      tokens: { prompt: 5, completion: 6 },
    });
    expect(fail.mock.calls[0]?.[1].rawResponse).toContain('"summary":"s"');
  });

  it('a rejected request fails once with LLM_REQUEST_REJECTED and a message free of provider text', async () => {
    const llm = new ScriptedLlmClient(new LlmError('rejected', 'bad key AIza-SECRET'));
    const { repo, run } = await setup(llm, 3);
    await run();
    const view = await repo.findById(job.analysisId);
    expect(llm.calls).toBe(1);
    expect(view?.error?.code).toBe('LLM_REQUEST_REJECTED');
    expect(view?.error?.message).not.toContain('AIza-SECRET');
  });

  it('an aborted run ends FAILED/INTERRUPTED without retrying', async () => {
    const llm = new ScriptedLlmClient(hangUntilAborted);
    const { repo, run } = await setup(llm, 3);
    const controller = new AbortController();

    const running = run(controller.signal);
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });
    controller.abort();
    await running;

    expect(llm.calls).toBe(1);
    expect(await repo.findById(job.analysisId)).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
  });
});
