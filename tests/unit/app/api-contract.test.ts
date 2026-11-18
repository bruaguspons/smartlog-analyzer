import { afterEach, describe, expect, it } from 'vitest';
import { buildContractRuntime } from '@tests/support/contract/build-contract-world.js';
import {
  CONTRACT_CASES,
  type ContractCase,
  type ContractReply,
  type ContractRequest,
  type ContractWorld,
} from '@tests/support/contract/contract-cases.js';

/**
 * Replays the request matrix against an HTTP implementation and compares what comes back with a golden
 * file committed next to this test. The golden file is the definition of "same API" across framework changes.
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

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** Fastify executor: in-process `inject`, no socket. */
function fastifyWorld(testCase: ContractCase): ContractWorld {
  const { runtime, logRepo, analysisRepo, llm } = buildContractRuntime(testCase.options);
  closers.push(() => runtime.app.close());
  const send: Executor = async (request) => {
    const res = await runtime.app.inject({
      method: request.method,
      url: request.url,
      headers: {
        ...request.headers,
        ...(request.body !== undefined && !request.noContentType && !request.headers?.['content-type'] && { 'content-type': 'application/json' }),
      },
      ...(request.body !== undefined && { payload: request.body }),
    });
    return toReply(res.statusCode, res.headers, res.body);
  };
  return { runtime, logRepo, analysisRepo, llm, send };
}

describe('HTTP contract (Fastify)', () => {
  it('matches the golden file', async () => {
    const recorded: Record<string, ContractReply> = {};
    for (const testCase of CONTRACT_CASES) {
      recorded[testCase.name] = await testCase.run(fastifyWorld(testCase));
    }
    expect(Object.keys(recorded)).toHaveLength(CONTRACT_CASES.length);
    await expect(`${JSON.stringify(recorded, null, 2)}\n`).toMatchFileSnapshot('./api-contract.golden.json');
  });
});
