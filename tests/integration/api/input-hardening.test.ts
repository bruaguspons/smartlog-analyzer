import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import type { Runtime } from '@/composition/create-runtime.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { okJson, ScriptedLlmClient } from '@tests/support/fakes/scripted-llm-client.js';
import { resetDatabaseWithService } from '@tests/support/integration/database.js';
import { authHeaders, buildIntegrationRuntime } from '@tests/support/integration/integration-app.js';

/**
 * Inputs Postgres cannot store (an Int4-overflowing serviceId, NUL in text or jsonb) are rejected at
 * validation with a 400 envelope, so they never reach the database or surface as a 500.
 */
const prisma = createPrismaClient(inject('databaseUrl'));
let runtime: Runtime;

interface ErrorBody {
  error: { code: string };
}

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabaseWithService(prisma);
  runtime = buildIntegrationRuntime({ prisma, llm: new ScriptedLlmClient(okJson({ summary: 's', findings: [] })) });
});

afterEach(async () => {
  await runtime.close();
});

const expectValidationError = (res: { status: number; body: unknown }) => {
  expect(res.status).toBe(400);
  expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
};

describe('input hardening against Postgres', () => {
  it('GET /api/logs with serviceId above Int4 is a 400 envelope, not a 500', async () => {
    const res = await request(runtime.app).get('/api/logs?serviceId=2147483648').set(authHeaders);

    expectValidationError(res);
  });

  it.each(['/api/logs?search=%00', '/api/logs?traceId=a%00b', '/api/logs/stats?search=%00'])(
    'GET %s is a 400 envelope',
    async (url) => {
      expectValidationError(await request(runtime.app).get(url).set(authHeaders));
    },
  );

  it('POST /api/logs/analyze with NUL in search or an Int4-overflowing serviceId is a 400 and creates nothing', async () => {
    for (const payload of [{ search: 'a\u0000b' }, { serviceId: 2147483648 }]) {
      expectValidationError(
        await request(runtime.app).post('/api/logs/analyze').set(authHeaders).send(payload),
      );
    }

    expect(await prisma.analysis.count()).toBe(0);
  });

  it.each([
    ['message', { message: 'a\u0000b' }],
    ['traceId', { traceId: 'a\u0000b' }],
    ['metadata value', { metadata: { k: 'a\u0000b' } }],
    ['metadata key', { metadata: { 'k\u0000': 1 } }],
  ])('POST /api/logs with NUL in %s is a 400 and writes no row', async (_name, patch) => {
    const payload = { level: 'ERROR', timestamp: '2026-11-04T08:00:00.000Z', message: 'boom', ...patch };

    expectValidationError(await request(runtime.app).post('/api/logs').set(authHeaders).send(payload));

    expect(await prisma.log.count()).toBe(0);
  });

  it('accepts literal backslash-u text and stores it verbatim', async () => {
    const message = String.raw`a\u0000b`;
    const payload = { level: 'ERROR', timestamp: '2026-11-04T08:00:00.000Z', message };

    const res = await request(runtime.app).post('/api/logs').set(authHeaders).send(payload);

    expect(res.status).toBe(201);
    expect((await prisma.log.findFirstOrThrow()).message).toBe(message);
  });
});
