import { createServer } from 'node:http';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntime, type Runtime } from '@/composition/create-runtime.js';
import { analysisRepository as analysisRepo } from '@/repositories/analysis.repository.js';
import { config } from '@/shared/config/config.js';
import { prisma } from '@/shared/db/prisma.js';
import { hangUntilAborted, okJson, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';
import { analysisId, logId, makeLog } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabaseWithService } from '@tests/support/integration/database.js';
import { authHeaders as headers, useFreshRunner } from '@tests/support/integration/integration-app.js';
import { scriptedLlm } from '@tests/support/integration/scripted-llm.js';

// Analysis ids come from one counter (the same values as `analysisId(n)`) and the model is a scripted one.
const ids = vi.hoisted(() => ({ counter: 0 }));
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUIDv7: () => `0192f1c0-aaaa-7000-8000-${String((ids.counter += 1)).padStart(12, '0')}`,
}));
vi.mock('@/llm/llm.js', async () => (await import('@tests/support/fakes/scripted-llm-module.js')).scriptedLlmModule());

const createdAt = new Date('2026-11-04T10:00:00.000Z');

/**
 * A scripted model, a runner that can be shut down for good, and a `$disconnect` spy so tests can observe
 * the order (the pool belongs to the whole test file).
 */
function fixture(...script: ScriptStep[]) {
  const llm = scriptedLlm();
  llm.reset(...(script.length > 0 ? script : [okJson({ summary: 's', findings: [] })]));
  useFreshRunner();
  const disconnect = vi.spyOn(prisma, '$disconnect').mockResolvedValue();
  return { llm, disconnect };
}
const leftoverProcessing = () =>
  analysisRepo.createProcessing({ id: analysisId(9), provider: 'mock', model: 'mock', createdAt }, [logId(1)]);

beforeAll(async () => {
  await prisma.$connect();
  // PORT=0 is rejected by the env schema on purpose; tests listen on an ephemeral port instead.
  Object.assign(config, { port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  ids.counter = 0;
  config.port = 0;
  await resetDatabaseWithService();
  await insertLogs([makeLog(1), makeLog(2)]);
});

describe('createRuntime against Postgres', () => {
  let current: Runtime | undefined;
  /** Registers the runtime so `afterEach` closes it even when a test fails. */
  const create = () => (current = createRuntime());

  afterEach(async () => {
    await current?.close();
    current = undefined;
  });

  it('leftover PROCESSING rows are recovered before the server listens, so the first POST is accepted', async () => {
    fixture();
    await leftoverProcessing();
    const runtime = create();
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
    fixture();
    vi.spyOn(analysisRepo, 'failAllProcessing').mockRejectedValue(new Error('db down'));
    const runtime = create();

    await expect(runtime.start()).rejects.toThrow('db down');

    expect(runtime.server.listening).toBe(false);
  });

  it('in-flight analyses are closed as INTERRUPTED before the database is disconnected', async () => {
    const { llm, disconnect } = fixture(hangUntilAborted);
    let statusAtDisconnect: string | undefined;
    disconnect.mockImplementation(async () => {
      statusAtDisconnect = (await analysisRepo.findById(analysisId(1)))?.status;
    });
    const runtime = create();
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
    const { llm, disconnect } = fixture(hangUntilAborted);
    const realFail = analysisRepo.fail.bind(analysisRepo);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(analysisRepo, 'fail').mockImplementation(async (...args) => {
      await gate;
      return realFail(...args);
    });
    const runtime = create();
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
    const { disconnect } = fixture();
    const runtime = create();
    vi.spyOn(runtime.runner, 'shutdown').mockRejectedValue(new Error('shutdown failed'));
    await runtime.start();

    await expect(runtime.close()).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a listen error such as a port already in use rejects start()', async () => {
    fixture();
    const occupier = createServer();
    await new Promise<void>((resolve) => occupier.listen(0, '127.0.0.1', resolve));
    const address = occupier.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    try {
      config.port = port;
      const runtime = create();

      await expect(runtime.start()).rejects.toThrow(/EADDRINUSE/);

      expect(runtime.server.listening).toBe(false);
    } finally {
      await new Promise((resolve) => occupier.close(resolve));
    }
  });

  it('close() stops the server, then the runner, then the database, each one only after the previous finished', async () => {
    const { disconnect } = fixture();
    const runtime = create();
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
    const { disconnect } = fixture();
    const runtime = create();
    await runtime.start();
    const shutdown = vi.spyOn(runtime.runner, 'shutdown');

    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.close();

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('close() before start() skips the server but still closes the runner and the database', async () => {
    const { disconnect } = fixture();
    const runtime = create();

    await runtime.close();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a failing server close does not stop the runner and the database from closing', async () => {
    const { disconnect } = fixture();
    const runtime = create();
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
