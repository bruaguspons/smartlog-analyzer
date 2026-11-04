import { describe, expect, it, vi, type Mock } from 'vitest';
import { AnalysisRunner } from '../../src/modules/analysis/application/analysis-runner.js';
import type { AnalysisJob } from '../../src/modules/analysis/application/process-analysis.js';
import { InMemoryAnalysisRepository } from '../../src/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { analysisId } from '../shared/analysis-repository-contract.js';
import { makeListLog } from '../shared/log-repository-list-contract.js';
import { hangUntilAborted, okJson, ScriptedLlmClient } from '../shared/scripted-llm-client.js';

const CREATED_AT = new Date('2026-11-04T10:00:00.000Z');
const logs = [makeListLog(1), makeListLog(2)];
const jobOf = (n: number): AnalysisJob => ({ analysisId: analysisId(n), logs, createdAt: CREATED_AT });
const ok = okJson({ summary: 'Resumen', findings: [] });

type LogFn = Mock<(obj: object, msg: string) => void>;

function silentLog(): Record<'info' | 'warn' | 'error', LogFn> {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

async function setup(llm: ScriptedLlmClient, maxRetries = 3) {
  const repo = new InMemoryAnalysisRepository();
  await repo.createProcessing(
    { id: analysisId(1), provider: llm.provider, model: llm.model, createdAt: CREATED_AT },
    logs.map((l) => l.id),
  );
  const runner = new AnalysisRunner({ repo, llm, policy: { timeoutMs: 30_000, maxRetries }, now: () => new Date() });
  return { repo, runner, log: silentLog() };
}

describe('AnalysisRunner', () => {
  it('runs a started job to COMPLETED; idle() resolves when it is done', async () => {
    const { repo, runner, log } = await setup(new ScriptedLlmClient(ok));

    runner.start(jobOf(1), log);
    await runner.idle();

    expect((await repo.findById(analysisId(1)))?.status).toBe('COMPLETED');
  });

  it('S15: an unexpected error from the client ends FAILED/INTERNAL_ERROR and is logged', async () => {
    const { repo, runner, log } = await setup(new ScriptedLlmClient(new TypeError('boom')));

    runner.start(jobOf(1), log);
    await runner.idle();

    expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', error: { code: 'INTERNAL_ERROR' } });
    expect(log.error).toHaveBeenCalled();
  });

  it('S16: shutdown() aborts the in-flight call, no retries, row FAILED/INTERRUPTED before it resolves', async () => {
    const llm = new ScriptedLlmClient(hangUntilAborted);
    const { repo, runner, log } = await setup(llm);
    runner.start(jobOf(1), log);
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });

    await runner.shutdown();

    expect(llm.calls).toBe(1);
    expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
  });

  it('a job started after shutdown still reaches a terminal state (INTERRUPTED)', async () => {
    const llm = new ScriptedLlmClient(ok);
    const { repo, runner, log } = await setup(llm);
    await runner.shutdown();

    runner.start(jobOf(1), log);
    await runner.idle();

    expect(llm.calls).toBe(0);
    expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
  });

  it('CAS: a row already closed by recovery is not overwritten by a late completion', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const llm = new ScriptedLlmClient(async () => {
      await gate;
      return ok;
    });
    const { repo, runner, log } = await setup(llm);
    runner.start(jobOf(1), log);
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });

    await repo.failAllProcessing({ errorCode: 'INTERRUPTED', errorMessage: 'recovered' });
    release();
    await runner.idle();

    expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
  });

  it('finally: if recording the failure itself fails once, a second attempt still closes the row INTERNAL_ERROR', async () => {
    const { repo, runner, log } = await setup(new ScriptedLlmClient(ok));
    vi.spyOn(repo, 'complete').mockRejectedValueOnce(new Error('db down'));
    const realFail = repo.fail.bind(repo);
    vi.spyOn(repo, 'fail').mockRejectedValueOnce(new Error('db still down')).mockImplementation(realFail);

    runner.start(jobOf(1), log);
    await runner.idle();

    expect(await repo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', error: { code: 'INTERNAL_ERROR' } });
    expect(log.error).toHaveBeenCalled();
  });

  it('a persistence failure is logged through the request logger and never rejects idle()', async () => {
    const { repo, runner, log } = await setup(new ScriptedLlmClient(ok));
    vi.spyOn(repo, 'complete').mockRejectedValue(new Error('db down'));
    vi.spyOn(repo, 'fail').mockRejectedValue(new Error('db down'));

    runner.start(jobOf(1), log);
    await expect(runner.idle()).resolves.toBeUndefined();

    expect(log.error).toHaveBeenCalled();
  });

  it('runs jobs independently and shutdown() waits for all of them', async () => {
    const llm = new ScriptedLlmClient(hangUntilAborted);
    const { repo, runner, log } = await setup(llm);
    await repo.fail(analysisId(1), { errorCode: 'INTERNAL_ERROR', errorMessage: 'x', rawResponse: null, usage: null, durationMs: 1 });
    await repo.createProcessing({ id: analysisId(2), provider: 'p', model: 'm', createdAt: CREATED_AT }, logs.map((l) => l.id));
    runner.start(jobOf(2), log);
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });

    await runner.shutdown();

    expect((await repo.findById(analysisId(2)))?.status).toBe('FAILED');
  });
});
