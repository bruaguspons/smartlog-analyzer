import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import type { Runtime } from '@/composition/create-runtime.js';
import { PrismaServiceRepository } from '@/repositories/prisma-service.repository.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { okJson, ScriptedLlmClient } from '@tests/support/fakes/scripted-llm-client.js';
import { resetDatabaseWithService } from '@tests/support/integration/database.js';
import { buildIntegrationRuntime } from '@tests/support/integration/integration-app.js';

const prisma = createPrismaClient(inject('databaseUrl'));
let runtime: Runtime;

function build(checkDatabase?: () => Promise<void>): Runtime {
  runtime = buildIntegrationRuntime({
    prisma,
    llm: new ScriptedLlmClient(okJson({ summary: 's', findings: [] })),
    ...(checkDatabase && { checkDatabase }),
  });
  return runtime;
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabaseWithService(prisma);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await runtime.close();
});

describe('GET /api/health against Postgres', () => {
  it('returns 200 ok when the database answers, without an API key', async () => {
    const findByApiKey = vi.spyOn(PrismaServiceRepository.prototype, 'findByApiKey');

    const res = await request(build().app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ok' });
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('ignores an invalid API key (public route)', async () => {
    const findByApiKey = vi.spyOn(PrismaServiceRepository.prototype, 'findByApiKey');

    const res = await request(build().app).get('/api/health').set('x-api-key', 'unknown');

    expect(res.status).toBe(200);
    expect(findByApiKey).not.toHaveBeenCalled();
  });

  it('returns 503 SERVICE_UNAVAILABLE in the error envelope when the database fails', async () => {
    const check = () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432'));

    const res = await request(build(check).app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unreachable', details: { database: 'unreachable' } },
    });
    expect(res.text).not.toContain('ECONNREFUSED');
  });

  it('keeps waiting at 1999 ms and answers 503 at 2000 ms when the database check hangs', async () => {
    let reached!: () => void;
    const checkReached = new Promise<void>((resolve) => (reached = resolve));
    const { app } = build(() => {
      reached();
      return new Promise<void>(() => undefined);
    });
    const server = app.listen(0);
    try {
      await new Promise((resolve) => server.once('listening', resolve));
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let settled = false;
      const pending = request(server)
        .get('/api/health')
        .then((res) => {
          settled = true;
          return res;
        });
      // The timeout is armed right before the check is called, so from here the fake clock decides.
      await checkReached;
      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await pending;
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    } finally {
      vi.useRealTimers();
      server.close();
    }
  });
});
