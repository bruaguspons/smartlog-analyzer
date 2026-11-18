import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { analysisRepository } from '@/repositories/analysis.repository.js';
import { prisma } from '@/shared/db/prisma.js';
import { analysisId, logId, makeLog } from '@tests/support/fixtures.js';
import { insertLogs, resetDatabaseWithService } from '@tests/support/integration/database.js';
import { authHeaders } from '@tests/support/integration/integration-app.js';

/**
 * The real entry point (`src/server.ts`) in its own process against the test database: startup order,
 * exit codes and the signal-driven shutdown cannot be observed from inside the test process.
 */
interface Server {
  child: ChildProcess;
  port: number;
  /** Log lines (JSON) and raw stderr, in order of arrival. */
  output: string[];
  exited: Promise<number | null>;
  /** Resolves once the process has logged that it listens. */
  listening: Promise<void>;
}

const running: ChildProcess[] = [];

async function freePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  probe.close();
  await once(probe, 'close');
  return port;
}

async function startServer(env: Record<string, string>): Promise<Server> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  const output: string[] = [];
  let resolveListening!: () => void;
  const listening = new Promise<void>((resolve) => {
    resolveListening = resolve;
  });
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n').filter(Boolean)) {
      output.push(line);
      if (line.includes('server listening')) resolveListening();
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  return { child, port, output, exited, listening };
}

const url = (server: Server, path: string) => `http://127.0.0.1:${String(server.port)}${path}`;
const indexOfMessage = (output: string[], text: string) => output.findIndex((line) => line.includes(text));

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabaseWithService();
  await insertLogs([makeLog(1), makeLog(2)]);
});

afterEach(() => {
  for (const child of running.splice(0)) child.kill('SIGKILL');
});

describe('server process', () => {
  it('exits with code 1 and names the variable when the configuration is invalid', async () => {
    const server = await startServer({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '' });

    expect(await server.exited).toBe(1);
    expect(server.output.join('\n')).toContain('GEMINI_API_KEY');
    expect(server.output.some((line) => line.includes('server listening'))).toBe(false);
  });

  it('closes leftover PROCESSING analyses before serving the first request', async () => {
    await analysisRepository.createProcessing(
      { id: analysisId(9), provider: 'mock', model: 'mock', createdAt: new Date('2026-11-04T10:00:00.000Z') },
      [logId(1)],
    );
    const server = await startServer({ LLM_PROVIDER: 'mock' });
    await server.listening;

    expect(await analysisRepository.findById(analysisId(9))).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
    const res = await fetch(url(server, '/api/logs/analyze'), {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(202);
  });

  it('on SIGTERM closes the in-flight analysis as INTERRUPTED and shuts down in order: server, runner, database', async () => {
    const server = await startServer({ LLM_PROVIDER: 'mock', LLM_MOCK_BEHAVIOR: 'timeout', LLM_MAX_RETRIES: '0' });
    await server.listening;
    const res = await fetch(url(server, '/api/logs/analyze'), {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    await expect.poll(async () => (await analysisRepository.findById(id))?.status).toBe('PROCESSING');

    server.child.kill('SIGTERM');

    expect(await server.exited).toBe(0);
    expect(await analysisRepository.findById(id)).toMatchObject({ status: 'FAILED', error: { code: 'INTERRUPTED' } });
    const stopped = indexOfMessage(server.output, 'http server stopped');
    const runner = indexOfMessage(server.output, 'analysis runner stopped');
    const database = indexOfMessage(server.output, 'database disconnected');
    expect(stopped).toBeGreaterThanOrEqual(0);
    expect(runner).toBeGreaterThan(stopped);
    expect(database).toBeGreaterThan(runner);
    await expect(fetch(url(server, '/api/health'))).rejects.toThrow();
  });
});
