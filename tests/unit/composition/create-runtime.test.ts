import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '@/composition/create-runtime.js';
import type { RuntimeDeps } from '@/composition/runtime.types.js';
import { InMemoryAnalysisRepository } from '@/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '@/modules/services/domain/service.types.js';
import { InMemoryServiceRepository } from '@/modules/services/infrastructure/in-memory-service-repository.js';
import type { Config } from '@/shared/config/config.types.js';
import { loadConfig } from '@/shared/config/load-config.js';
import { analysisId, logId } from '@tests/support/contracts/analysis-repository-contract.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';
import { hangUntilAborted, okJson, ScriptedLlmClient, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';

const baseEnv = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', LOG_LEVEL: 'silent' };
// PORT=0 is rejected by the env schema on purpose; tests listen on an ephemeral port instead.
const config: Config = { ...loadConfig(baseEnv), port: 0, host: '127.0.0.1' };
const service: Service = { id: 1, name: 'svc', description: null, apiKey: 'k', isActive: true };
const headers = { 'x-api-key': 'k' };
const createdAt = new Date('2026-11-04T10:00:00.000Z');
function fixture(...script: ScriptStep[]) {
  const analysisRepo = new InMemoryAnalysisRepository();
  const logRepo = new InMemoryLogRepository();
  logRepo.logs.push(makeListLog(1), makeListLog(2));
  const llm = new ScriptedLlmClient(...(script.length > 0 ? script : [okJson({ summary: 's', findings: [] })]));
  const disconnect = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const deps: RuntimeDeps = {
    serviceRepo: new InMemoryServiceRepository([service]),
    logRepo,
    analysisRepo,
    llm,
    checkDatabase: () => Promise.resolve(),
    disconnect,
  };
  return { analysisRepo, llm, disconnect, deps };
}
const leftoverProcessing = (repo: InMemoryAnalysisRepository) =>
  repo.createProcessing({ id: analysisId(9), provider: 'mock', model: 'mock', createdAt }, [logId(1)]);

describe('createRuntime', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('leftover PROCESSING rows are recovered before the server listens, so the first POST is accepted', async () => {
    const { analysisRepo, deps } = fixture();
    await leftoverProcessing(analysisRepo);
    const runtime = createRuntime(config, deps);
    app = runtime.app;
    const recover = analysisRepo.failAllProcessing.bind(analysisRepo);
    const listeningWhenRecovering: boolean[] = [];
    vi.spyOn(analysisRepo, 'failAllProcessing').mockImplementation((...args) => {
      listeningWhenRecovering.push(runtime.app.server.listening);
      return recover(...args);
    });

    await runtime.start();

    expect(listeningWhenRecovering).toEqual([false]);
    expect(app.server.listening).toBe(true);
    expect(await analysisRepo.findById(analysisId(9))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
    const res = await app.inject({ method: 'POST', url: '/api/logs/analyze', headers, payload: {} });
    expect(res.statusCode).toBe(202);
    await runtime.runner.idle();
  });

  it('when recovery fails, start() rejects and the server never listens', async () => {
    const { analysisRepo, deps } = fixture();
    vi.spyOn(analysisRepo, 'failAllProcessing').mockRejectedValue(new Error('db down'));
    const runtime = createRuntime(config, deps);
    app = runtime.app;

    await expect(runtime.start()).rejects.toThrow('db down');

    expect(app.server.listening).toBe(false);
  });

  it('in-flight analyses are closed as INTERRUPTED before the database is disconnected', async () => {
    const { analysisRepo, llm, disconnect, deps } = fixture(hangUntilAborted);
    let statusAtDisconnect: string | undefined;
    disconnect.mockImplementation(async () => {
      statusAtDisconnect = (await analysisRepo.findById(analysisId(1)))?.status;
    });
    let counter = 0;
    const runtime = createRuntime(config, { ...deps, newId: () => analysisId((counter += 1)) });
    app = runtime.app;
    await runtime.start();
    const res = await app.inject({ method: 'POST', url: '/api/logs/analyze', headers, payload: {} });
    expect(res.statusCode).toBe(202);
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });

    await app.close();

    expect(statusAtDisconnect).toBe('FAILED');
    expect(await analysisRepo.findById(analysisId(1))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a slow runner shutdown delays the disconnect until it has finished', async () => {
    const { analysisRepo, llm, disconnect, deps } = fixture(hangUntilAborted);
    const realFail = analysisRepo.fail.bind(analysisRepo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(analysisRepo, 'fail').mockImplementation(async (...args) => {
      await gate;
      return realFail(...args);
    });
    let counter = 0;
    const runtime = createRuntime(config, { ...deps, newId: () => analysisId((counter += 1)) });
    app = runtime.app;
    await runtime.start();
    await app.inject({ method: 'POST', url: '/api/logs/analyze', headers, payload: {} });
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });

    const closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(disconnect).not.toHaveBeenCalled();

    release();
    await closing;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a failing runner shutdown does not prevent the disconnect, so the pool is always released', async () => {
    const { disconnect, deps } = fixture();
    const runtime = createRuntime(config, deps);
    app = runtime.app;
    vi.spyOn(runtime.runner, 'shutdown').mockRejectedValue(new Error('shutdown failed'));
    await runtime.start();

    await expect(app.close()).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
