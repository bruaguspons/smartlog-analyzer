import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { buildExpressApp } from '@tests/support/apps/build-express-app.js';
import { buildContractDeps, buildContractRuntime } from '@tests/support/contract/build-contract-world.js';
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
 * The Express app and the Fastify runtime must both match it byte for byte: the file is never edited to make one pass.
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
  return { runner: runtime.runner, logRepo, analysisRepo, llm, send };
}

/** Express executor: in-process supertest against the app built from the same fakes. */
function expressWorld(testCase: ContractCase): ContractWorld {
  const { config, deps, logRepo, analysisRepo, llm } = buildContractDeps(testCase.options);
  const { app, runner } = buildExpressApp(config, deps);
  closers.push(() => runner.shutdown());
  const send: Executor = async (contract) => {
    const method = contract.method.toLowerCase() as 'get' | 'post' | 'head';
    const req = request(app)[method](contract.url).set(contract.headers ?? {});
    if (contract.noContentType) req.unset('Content-Type');
    else if (contract.body !== undefined && !contract.headers?.['content-type']) req.set('Content-Type', 'application/json');
    const res = await (contract.body === undefined ? req : req.send(contract.body));
    return toReply(res.status, res.headers, res.text ?? '');
  };
  return { runner, logRepo, analysisRepo, llm, send };
}

async function record(buildWorld: (testCase: ContractCase) => ContractWorld): Promise<string> {
  const recorded: Record<string, ContractReply> = {};
  for (const testCase of CONTRACT_CASES) {
    recorded[testCase.name] = await testCase.run(buildWorld(testCase));
  }
  expect(Object.keys(recorded)).toHaveLength(CONTRACT_CASES.length);
  return `${JSON.stringify(recorded, null, 2)}\n`;
}

describe('HTTP contract', () => {
  it('Fastify matches the golden file', async () => {
    await expect(await record(fastifyWorld)).toMatchFileSnapshot('./api-contract.golden.json');
  });

  it('Express matches the golden file', async () => {
    await expect(await record(expressWorld)).toMatchFileSnapshot('./api-contract.golden.json');
  });
});
