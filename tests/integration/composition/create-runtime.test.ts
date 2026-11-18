import { createServer } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { createRuntime, type Runtime, type RuntimeDeps } from '@/composition/create-runtime.js';
import { PrismaAnalysisRepository } from '@/repositories/prisma-analysis.repository.js';
import type { Config } from '@/shared/config/load-config.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { hangUntilAborted, okJson, ScriptedLlmClient, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';
import { analysisId, logId, makeLog } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabaseWithService } from '@tests/support/integration/database.js';
import { authHeaders as headers, buildIntegrationDeps } from '@tests/support/integration/integration-app.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const analysisRepo = new PrismaAnalysisRepository(prisma);
const createdAt = new Date('2026-11-04T10:00:00.000Z');

/** Real repositories over Postgres with a scripted model; `disconnect` is a spy so tests can observe the order. */
function fixture(...script: ScriptStep[]) {
  const llm = new ScriptedLlmClient(...(script.length > 0 ? script : [okJson({ summary: 's', findings: [] })]));
  const disconnect = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const { config: base, deps } = buildIntegrationDeps({ prisma, llm, wrapAnalysisRepo: () => analysisRepo, onDisconnect: disconnect });
  // PORT=0 is rejected by the env schema on purpose; tests listen on an ephemeral port instead.
  const config: Config = { ...base, port: 0, host: '127.0.0.1' };
  return { config, llm, disconnect, deps };
}
const leftoverProcessing = () =>
  analysisRepo.createProcessing({ id: analysisId(9), provider: 'mock', model: 'mock', createdAt }, [logId(1)]);

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDatabaseWithService(prisma);
  await insertLogs(prisma, [makeLog(1), makeLog(2)]);
});

describe('createRuntime against Postgres', () => {
  let current: Runtime | undefined;
  /** Registers the runtime so `afterEach` closes it even when a test fails. */
  const create = (config: Config, deps: RuntimeDeps) => (current = createRuntime(config, deps));

  afterEach(async () => {
    await current?.close();
    current = undefined;
  });

  it('leftover PROCESSING rows are recovered before the server listens, so the first POST is accepted', async () => {
    const { config, deps } = fixture();
    await leftoverProcessing();
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
    const { config, deps } = fixture();
    vi.spyOn(analysisRepo, 'failAllProcessing').mockRejectedValue(new Error('db down'));
    const runtime = create(config, deps);

    await expect(runtime.start()).rejects.toThrow('db down');

    expect(runtime.server.listening).toBe(false);
  });

  it('in-flight analyses are closed as INTERRUPTED before the database is disconnected', async () => {
    const { config, llm, disconnect, deps } = fixture(hangUntilAborted);
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
    const { config, llm, disconnect, deps } = fixture(hangUntilAborted);
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
    const { config, disconnect, deps } = fixture();
    const runtime = create(config, deps);
    vi.spyOn(runtime.runner, 'shutdown').mockRejectedValue(new Error('shutdown failed'));
    await runtime.start();

    await expect(runtime.close()).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a listen error such as a port already in use rejects start()', async () => {
    const { config, deps } = fixture();
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
    const { config, deps, disconnect } = fixture();
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
    const { config, deps, disconnect } = fixture();
    const runtime = create(config, deps);
    await runtime.start();
    const shutdown = vi.spyOn(runtime.runner, 'shutdown');

    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('close() before start() skips the server but still closes the runner and the database', async () => {
    const { config, deps, disconnect } = fixture();
    const runtime = create(config, deps);

    await runtime.close();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a failing server close does not stop the runner and the database from closing', async () => {
    const { config, deps, disconnect } = fixture();
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
