import { createServer } from 'node:http';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime, type Runtime, type RuntimeDeps } from '@/composition/create-runtime.js';
import { InMemoryAnalysisRepository } from '@/repositories/in-memory-analysis.repository.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
import type { Service } from '@/models/service.js';
import { InMemoryServiceRepository } from '@/repositories/in-memory-service.repository.js';
import { loadConfig, type Config } from '@/shared/config/load-config.js';
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
  let current: Runtime | undefined;
  /** Registers the runtime so `afterEach` closes it even when a test fails. */
  const create = (...args: Parameters<typeof createRuntime>) => (current = createRuntime(...args));

  afterEach(async () => {
    await current?.close();
    current = undefined;
  });

  it('leftover PROCESSING rows are recovered before the server listens, so the first POST is accepted', async () => {
    const { analysisRepo, deps } = fixture();
    await leftoverProcessing(analysisRepo);
    const runtime = create(config, deps);
    const recover = analysisRepo.failAllProcessing.bind(analysisRepo);
    const listeningWhenRecovering: boolean[] = [];
    vi.spyOn(analysisRepo, 'failAllProcessing').mockImplementation((...args) => {
      listeningWhenRecovering.push(runtime.server.listening);
      return recover(...args);
    });

    await runtime.start();

    expect(listeningWhenRecovering).toEqual([false]);
    expect(runtime.server.listening).toBe(true);
    expect(await analysisRepo.findById(analysisId(9))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
    const res = await request(runtime.server).post('/api/logs/analyze').set(headers).send({});
    expect(res.status).toBe(202);
    await runtime.runner.idle();
  });

  it('when recovery fails, start() rejects and the server never listens', async () => {
    const { analysisRepo, deps } = fixture();
    vi.spyOn(analysisRepo, 'failAllProcessing').mockRejectedValue(new Error('db down'));
    const runtime = create(config, deps);

    await expect(runtime.start()).rejects.toThrow('db down');

    expect(runtime.server.listening).toBe(false);
  });

  it('in-flight analyses are closed as INTERRUPTED before the database is disconnected', async () => {
    const { analysisRepo, llm, disconnect, deps } = fixture(hangUntilAborted);
    let statusAtDisconnect: string | undefined;
    disconnect.mockImplementation(async () => {
      statusAtDisconnect = (await analysisRepo.findById(analysisId(1)))?.status;
    });
    let counter = 0;
    const runtime = create(config, { ...deps, newId: () => analysisId((counter += 1)) });
    await runtime.start();
    const res = await request(runtime.server).post('/api/logs/analyze').set(headers).send({});
    expect(res.status).toBe(202);
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });

    await runtime.close();

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
    const runtime = create(config, { ...deps, newId: () => analysisId((counter += 1)) });
    await runtime.start();
    await request(runtime.server).post('/api/logs/analyze').set(headers).send({});
    await vi.waitFor(() => {
      expect(llm.calls).toBe(1);
    });

    const closing = runtime.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(disconnect).not.toHaveBeenCalled();

    release();
    await closing;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a failing runner shutdown does not prevent the disconnect, so the pool is always released', async () => {
    const { disconnect, deps } = fixture();
    const runtime = create(config, deps);
    vi.spyOn(runtime.runner, 'shutdown').mockRejectedValue(new Error('shutdown failed'));
    await runtime.start();

    await expect(runtime.close()).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a listen error such as a port already in use rejects start()', async () => {
    const { deps } = fixture();
    const occupier = createServer();
    await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
    const address = occupier.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      const runtime = create({ ...config, port }, deps);

      await expect(runtime.start()).rejects.toThrow(/EADDRINUSE/);

      expect(runtime.server.listening).toBe(false);
    } finally {
      await new Promise((resolve) => occupier.close(resolve));
    }
  });

  it('close() stops the server, then the runner, then the database, each one only after the previous finished', async () => {
    const { deps, disconnect } = fixture();
    const runtime = create(config, deps);
    await runtime.start();
    const order: string[] = [];
    const serverClose = runtime.server.close.bind(runtime.server);
    vi.spyOn(runtime.server, 'close').mockImplementation((callback) => {
      order.push('server');
      return serverClose(callback);
    });
    vi.spyOn(runtime.runner, 'shutdown').mockImplementation(() => {
      order.push(runtime.server.listening ? 'runner (server still listening)' : 'runner');
      return Promise.resolve();
    });
    disconnect.mockImplementation(() => {
      order.push('disconnect');
      return Promise.resolve();
    });

    await runtime.close();

    expect(order).toEqual(['server', 'runner', 'disconnect']);
  });

  it('close() is idempotent: a second call shares the first one and nothing runs twice', async () => {
    const { deps, disconnect } = fixture();
    const runtime = create(config, deps);
    await runtime.start();
    const shutdown = vi.spyOn(runtime.runner, 'shutdown');

    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('close() before start() skips the server but still closes the runner and the database', async () => {
    const { deps, disconnect } = fixture();
    const runtime = create(config, deps);

    await runtime.close();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a failing server close does not stop the runner and the database from closing', async () => {
    const { deps, disconnect } = fixture();
    const runtime = create(config, deps);
    await runtime.start();
    const shutdown = vi.spyOn(runtime.runner, 'shutdown');
    vi.spyOn(runtime.server, 'close').mockImplementation((callback) => {
      callback?.(new Error('close failed'));
      return runtime.server;
    });

    await expect(runtime.close()).resolves.toBeUndefined();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
