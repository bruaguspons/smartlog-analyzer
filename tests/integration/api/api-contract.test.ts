import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from '@/app.js';
import { prisma } from '@/shared/db/prisma.js';
import { buildContractWorld } from '@tests/support/contract/contract-world.js';
import {
  CONTRACT_CASES,
  NOW,
  type ContractCase,
  type ContractReply,
  type ContractRequest,
  type ContractWorld,
} from '@tests/support/contract/contract-cases.js';
import { settleAnalyses } from '@tests/support/integration/database.js';

// Ids and the clock are fixed instead of normalized, so the golden file is compared byte for byte.
// Only `randomUUIDv7` is replaced; the rest of `node:crypto` (request ids, the pg driver) stays real.
const ids = vi.hoisted(() => ({ counter: 0 }));
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUIDv7: () => `0192f1c0-cccc-7000-8000-${String((ids.counter += 1)).padStart(12, '0')}`,
}));
// A scripted model replaces the configured one.
vi.mock('@/llm/llm.js', async () => (await import('@tests/support/fakes/scripted-llm-module.js')).scriptedLlmModule());

/**
 * Replays the request matrix against the real app over Postgres and compares what comes back with a
 * golden file committed next to this test. The golden file is the definition of "same API" across refactors:
 * it was recorded before the framework switch and is never edited to make the app pass.
 */
type Executor = (request: ContractRequest) => Promise<ContractReply>;

/** Headers whose presence would be a contract change (the API never sent them). */
const MUST_BE_ABSENT = ['etag', 'x-powered-by'] as const;

function toReply(status: number, headers: Record<string, unknown>, text: string): ContractReply {
  const contentType = typeof headers['content-type'] === 'string' ? headers['content-type'] : null;
  const body: unknown = contentType?.includes('json') && text !== '' ? JSON.parse(text) : text;
  const present = MUST_BE_ABSENT.filter((name) => headers[name] !== undefined);
  return {
    status,
    contentType,
    body,
    ...(present.length > 0 && { headers: Object.fromEntries(present.map((name) => [name, String(headers[name])])) }),
  };
}


beforeAll(async () => {
  await prisma.$connect();
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});

afterAll(async () => {
  vi.useRealTimers();
  await prisma.$disconnect();
});

/** In-process supertest against the real app (without listening) over Postgres. */
async function buildWorld(testCase: ContractCase): Promise<ContractWorld> {
  ids.counter = 0;
  const { runner, logRepo, llm } = await buildContractWorld(testCase.options);
  const send: Executor = async (contract) => {
    const method = contract.method.toLowerCase() as 'get' | 'post' | 'head';
    const req = request(app)[method](contract.url).set(contract.headers ?? {});
    if (contract.noContentType) req.unset('Content-Type');
    else if (contract.body !== undefined && !contract.headers?.['content-type']) req.set('Content-Type', 'application/json');
    const res = await (contract.body === undefined ? req : req.send(contract.body));
    return toReply(res.status, res.headers, res.text ?? '');
  };
  return { runner, logRepo, llm, send };
}

async function record(): Promise<string> {
  const recorded: Record<string, ContractReply> = {};
  for (const testCase of CONTRACT_CASES) {
    const world = await buildWorld(testCase);
    try {
      recorded[testCase.name] = await testCase.run(world);
    } finally {
      // A case may leave an analysis hanging: let it finish before the next case empties the database.
      await settleAnalyses({ llm: world.llm, runner: world.runner });
      vi.restoreAllMocks();
    }
  }
  expect(Object.keys(recorded)).toHaveLength(CONTRACT_CASES.length);
  return `${JSON.stringify(recorded, null, 2)}\n`;
}

describe('HTTP contract', () => {
  it('the app matches the golden file', async () => {
    await expect(await record()).toMatchFileSnapshot('./api-contract.golden.json');
  });
});
