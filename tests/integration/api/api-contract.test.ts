import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { buildContractRuntime } from '@tests/support/contract/contract-world.js';
import {
  CONTRACT_CASES,
  type ContractCase,
  type ContractReply,
  type ContractRequest,
  type ContractWorld,
} from '@tests/support/contract/contract-cases.js';

/**
 * Replays the request matrix against the real runtime over Postgres and compares what comes back with a
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

const prisma = createPrismaClient(inject('databaseUrl'));

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** One case: the world it runs in and how to close it. */
interface BuiltWorld {
  world: ContractWorld;
  close: () => Promise<void>;
}

/** In-process supertest against the real runtime (without listening) over Postgres. */
async function buildWorld(testCase: ContractCase): Promise<BuiltWorld> {
  const { runtime, logRepo, llm } = await buildContractRuntime(prisma, testCase.options);
  const { app, runner } = runtime;
  const send: Executor = async (contract) => {
    const method = contract.method.toLowerCase() as 'get' | 'post' | 'head';
    const req = request(app)[method](contract.url).set(contract.headers ?? {});
    if (contract.noContentType) req.unset('Content-Type');
    else if (contract.body !== undefined && !contract.headers?.['content-type']) req.set('Content-Type', 'application/json');
    const res = await (contract.body === undefined ? req : req.send(contract.body));
    return toReply(res.status, res.headers, res.text ?? '');
  };
  return { world: { runner, logRepo, llm, send }, close: () => runtime.close() };
}

async function record(): Promise<string> {
  const recorded: Record<string, ContractReply> = {};
  for (const testCase of CONTRACT_CASES) {
    const { world, close } = await buildWorld(testCase);
    try {
      recorded[testCase.name] = await testCase.run(world);
    } finally {
      // A case may leave an analysis hanging: close it before the next case empties the database.
      await close();
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
