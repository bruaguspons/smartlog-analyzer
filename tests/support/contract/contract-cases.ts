import type { AnalysisRunner } from '@/services/analysis-runner.js';
import { InMemoryAnalysisRepository } from '@/repositories/in-memory-analysis.repository.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
import { analysisId } from '@tests/support/contracts/analysis-repository-contract.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';
import { hangUntilAborted, okJson, ScriptedLlmClient, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';

/** A request described without reference to any HTTP framework, so every executor can replay it. */
export interface ContractRequest {
  method: 'GET' | 'POST' | 'HEAD';
  url: string;
  headers?: Record<string, string>;
  /** Raw body, sent exactly as given. */
  body?: string;
  /** Omits the content-type header entirely even when there is a body. */
  noContentType?: boolean;
}

/** What the contract pins for each response: status, content type, body and the headers that must stay absent. */
export interface ContractReply {
  status: number;
  contentType: string | null;
  body: unknown;
  headers?: Record<string, string>;
}

export interface ContractWorld {
  /** The app under test: its runner and in-memory fakes are exposed so a case can arrange state. */
  runner: Pick<AnalysisRunner, 'idle'>;
  logRepo: InMemoryLogRepository;
  analysisRepo: InMemoryAnalysisRepository;
  llm: ScriptedLlmClient;
  send: (request: ContractRequest) => Promise<ContractReply>;
}

export interface ContractCase {
  name: string;
  /** Overrides how the world is built (a failing database, a model that never answers...). */
  options?: WorldOptions;
  /** Arranges extra state or sends several requests; returns the reply that gets recorded. */
  run: (world: ContractWorld) => Promise<ContractReply>;
}

export interface WorldOptions {
  checkDatabase?: () => Promise<void>;
  script?: ScriptStep[];
}

export const NOW = new Date('2026-11-04T12:00:00.000Z');
export const KEY = 'k-payments';
export const OTHER_KEY = 'k-orders';
export const INACTIVE_KEY = 'k-inactive';
const auth = { 'x-api-key': KEY };
const json = { 'content-type': 'application/json' };
const authJson = { ...auth, ...json };

export const defaultScript = (): ScriptStep[] => [
  okJson({
    summary: 'Database connection problems',
    findings: [
      {
        category: 'database',
        severity: 'HIGH',
        description: 'Connection pool exhausted',
        suggestions: ['Increase the pool size'],
        logRefs: [1, 2, 99],
      },
    ],
  }),
];

export const hangingScript = (): ScriptStep[] => [hangUntilAborted];

/** Three logs for service 7 (ERROR, INFO, ERROR) and one for service 8. */
export function seedLogs(logRepo: InMemoryLogRepository): void {
  logRepo.logs.push(
    makeListLog(1, { serviceId: 7, level: 'ERROR', traceId: 'trace-1', metadata: { attempt: 1 } }),
    makeListLog(2, { serviceId: 7, level: 'INFO' }),
    makeListLog(3, { serviceId: 7, level: 'ERROR' }),
    makeListLog(4, { serviceId: 8, level: 'WARN' }),
  );
}

const validLog = { level: 'ERROR', timestamp: '2026-11-04T08:00:00.000Z', message: 'boom', traceId: 't-1', metadata: { a: 1, nested: { b: [1, 'x', null] } } };
const post = (url: string, body: string, headers: Record<string, string> = authJson): ContractRequest => ({ method: 'POST', url, headers, body });
const get = (url: string, headers: Record<string, string> = auth): ContractRequest => ({ method: 'GET', url, headers });

/** A case that sends one request and records its reply. */
const simple = (name: string, request: ContractRequest, options?: WorldOptions): ContractCase => ({
  name,
  ...(options && { options }),
  run: ({ send }) => send(request),
});

const bigBody = JSON.stringify({ level: 'INFO', timestamp: '2026-11-04T08:00:00.000Z', message: 'x'.repeat(1_048_577) });

const levels21 = Array.from({ length: 21 }, () => 'level=ERROR').join('&');

export const CONTRACT_CASES: ContractCase[] = [
  // Success responses.
  simple('health ok without key', { method: 'GET', url: '/api/health' }),
  simple('health ok with a bad key', { method: 'GET', url: '/api/health', headers: { 'x-api-key': 'nope' } }),
  simple('health HEAD', { method: 'HEAD', url: '/api/health' }),
  simple('health 503 when the database is down', { method: 'GET', url: '/api/health' }, { checkDatabase: () => Promise.reject(new Error('secret db detail')) }),
  simple('ingest 201', post('/api/logs', JSON.stringify(validLog))),
  simple('ingest 201 with the other service key', post('/api/logs', JSON.stringify({ level: 'DEBUG', timestamp: '2026-11-04T08:00:00+02:00', message: 'm' }), { 'x-api-key': OTHER_KEY, ...json })),
  simple('list default', get('/api/logs')),
  simple('list HEAD', { method: 'HEAD', url: '/api/logs', headers: auth }),
  simple('list filtered by service, level, dates, trace and search', get('/api/logs?serviceId=7&level=ERROR&from=2026-11-03T10:00:00Z&to=2026-11-03T10:00:09Z&traceId=trace-1&search=MESSAGE')),
  simple('list coerces limit', get('/api/logs?limit=2')),
  {
    name: 'list second page from a cursor',
    run: async ({ send }) => {
      const first = await send(get('/api/logs?limit=2'));
      const { nextCursor } = first.body as { nextCursor: string };
      return send(get(`/api/logs?limit=2&cursor=${encodeURIComponent(nextCursor)}`));
    },
  },
  simple('list level repeated', get('/api/logs?level=ERROR&level=INFO')),
  simple('list level in brackets', get('/api/logs?level[]=ERROR')),
  simple('list nested query key', get('/api/logs?a[b]=1')),
  simple('list 21 repeated levels', get(`/api/logs?${levels21}`)),
  simple('stats 200', get('/api/logs/stats')),
  simple('stats filtered', get('/api/logs/stats?serviceId=7&level=ERROR&level=INFO')),
  simple('analyze 202', post('/api/logs/analyze', '{}')),
  simple('analyze 202 with filters in the body', post('/api/logs/analyze', JSON.stringify({ serviceId: 7, level: ['ERROR'], limit: 1 }))),
  {
    name: 'get analysis completed',
    run: async ({ send, runner }) => {
      const started = await send(post('/api/logs/analyze', '{}'));
      await runner.idle();
      return send(get(`/api/analysis/${(started.body as { id: string }).id}`));
    },
  },
  {
    name: 'get analysis processing',
    options: { script: hangingScript() },
    run: async ({ send }) => {
      const started = await send(post('/api/logs/analyze', '{}'));
      return send(get(`/api/analysis/${(started.body as { id: string }).id}`));
    },
  },
  simple('get analysis unknown id', get(`/api/analysis/${analysisId(404)}`)),
  simple('get analysis id is not a uuid', get('/api/analysis/not-a-uuid')),
  {
    name: 'analyze 409 while another analysis runs',
    options: { script: hangingScript() },
    run: async ({ send }) => {
      await send(post('/api/logs/analyze', '{}'));
      return send(post('/api/logs/analyze', '{}'));
    },
  },
  simple('analyze 422 without matching logs', post('/api/logs/analyze', JSON.stringify({ level: ['FATAL'] }))),

  // Auth: the four ways of being unauthorized look the same.
  simple('401 without key', { method: 'GET', url: '/api/logs' }),
  simple('401 with an empty key', get('/api/logs', { 'x-api-key': '' })),
  simple('401 with an unknown key', get('/api/logs', { 'x-api-key': 'nope' })),
  simple('401 with an inactive service key', get('/api/logs', { 'x-api-key': INACTIVE_KEY })),
  simple('401 with a key that is too long', get('/api/logs', { 'x-api-key': 'k'.repeat(300) })),
  simple('401 beats an invalid body', post('/api/logs', '{bad', json)),
  simple('401 beats an oversized body', post('/api/logs', bigBody, json)),
  simple('401 beats an unsupported content type', post('/api/logs', 'a', { 'content-type': 'text/xml' })),

  // Not found and routing strictness.
  simple('404 root', { method: 'GET', url: '/' }),
  simple('404 unknown path without key', { method: 'GET', url: '/nope' }),
  simple('404 unknown api path without key', { method: 'GET', url: '/api/x' }),
  simple('404 unknown api path with key', get('/api/x')),
  simple('404 unknown docs path', { method: 'GET', url: '/docs/x' }),
  simple('404 trailing slash', get('/api/logs/')),
  simple('404 upper case path', get('/API/logs')),
  simple('404 method not allowed', { method: 'GET', url: '/api/logs/analyze', headers: auth }),
  simple('404 unknown route with malformed json and key', post('/api/nope', '{bad')),
  simple('404 unknown route with malformed json without key', post('/api/nope', '{bad', json)),
  simple('unknown route with a valid json body', post('/api/nope', '{"a":1}')),
  simple('unknown route with an empty json body', post('/api/nope', '')),
  simple('unknown route with an unsupported content type', post('/api/nope', '<a/>', { ...auth, 'content-type': 'text/xml' })),
  simple('unknown route with a body over 1 MiB', post('/api/nope', bigBody)),
  simple('unknown route outside api with malformed json', post('/nope', '{bad', json)),

  // Validation.
  simple('ingest invalid level', post('/api/logs', JSON.stringify({ ...validLog, level: 'LOUD' }))),
  simple('ingest unknown key serviceId', post('/api/logs', JSON.stringify({ ...validLog, serviceId: 1 }))),
  simple('ingest several issues', post('/api/logs', JSON.stringify({ level: 'LOUD', timestamp: 'yesterday', message: '' }))),
  simple('ingest missing everything', post('/api/logs', '{}')),
  simple('ingest array body (root-level issue)', post('/api/logs', '[]')),
  simple('ingest null body', post('/api/logs', 'null')),
  simple('ingest timestamp in the future', post('/api/logs', JSON.stringify({ ...validLog, timestamp: '2026-11-04T13:00:00Z' }))),
  simple('ingest NUL in the message', post('/api/logs', '{"level":"INFO","timestamp":"2026-11-04T08:00:00Z","message":"a\\u0000b"}')),
  simple('ingest NUL in a metadata key', post('/api/logs', '{"level":"INFO","timestamp":"2026-11-04T08:00:00Z","message":"m","metadata":{"k\\u0000":1}}')),
  simple('ingest metadata with a non-JSON value', post('/api/logs', '{"level":"INFO","timestamp":"2026-11-04T08:00:00Z","message":"m","metadata":[1]}')),
  simple('list invalid level', get('/api/logs?level=LOUD')),
  simple('list limit above the maximum', get('/api/logs?limit=201')),
  simple('list limit is not a number', get('/api/logs?limit=abc')),
  simple('list bad date', get('/api/logs?from=yesterday')),
  simple('list from after to', get('/api/logs?from=2026-11-04T00:00:00Z&to=2026-11-03T00:00:00Z')),
  simple('list serviceId is not a number', get('/api/logs?serviceId=abc')),
  simple('list serviceId above Int4', get('/api/logs?serviceId=2147483648')),
  simple('list NUL in search', get('/api/logs?search=%00')),
  simple('list unknown query key', get('/api/logs?foo=1')),
  simple('list tampered cursor', get('/api/logs?cursor=garbage')),
  simple('stats rejects limit', get('/api/logs/stats?limit=5')),
  simple('stats rejects cursor', get('/api/logs/stats?cursor=abc')),
  simple('analyze invalid body', post('/api/logs/analyze', JSON.stringify({ limit: 201, level: ['LOUD'] }))),
  simple('analyze body with an unknown key', post('/api/logs/analyze', '{"foo":1}')),

  // Body handling.
  simple('malformed json', post('/api/logs', '{bad')),
  simple('empty body with json content type', post('/api/logs', '')),
  simple('body without content type', { method: 'POST', url: '/api/logs', headers: auth, body: JSON.stringify(validLog), noContentType: true }),
  simple('no body and no content type', { method: 'POST', url: '/api/logs', headers: auth }),
  simple('unsupported content type', post('/api/logs', '<a/>', { ...auth, 'content-type': 'text/xml' })),
  simple('json content type with a charset', post('/api/logs', JSON.stringify(validLog), { ...auth, 'content-type': 'application/json; charset=utf-8' })),
  simple('json content type in upper case', post('/api/logs', JSON.stringify(validLog), { ...auth, 'content-type': 'Application/JSON' })),
  simple('vendor json content type', post('/api/logs', JSON.stringify(validLog), { ...auth, 'content-type': 'application/vnd.api+json' })),
  simple('text/plain content type', post('/api/logs', 'hello', { ...auth, 'content-type': 'text/plain' })),
  simple('body over 1 MiB', post('/api/logs', bigBody)),
  simple('__proto__ in the body', post('/api/logs', '{"__proto__":{"x":1},"level":"INFO","timestamp":"2026-11-04T08:00:00Z","message":"m"}')),
  simple('constructor.prototype in the body', post('/api/logs', '{"constructor":{"prototype":{"x":1}},"level":"INFO","timestamp":"2026-11-04T08:00:00Z","message":"m"}')),
  simple('__proto__ inside metadata', post('/api/logs', '{"level":"INFO","timestamp":"2026-11-04T08:00:00Z","message":"m","metadata":{"__proto__":{"x":1}}}')),

  // Unexpected failures never leak internals.
  {
    name: '500 hides the internal error',
    run: ({ send, logRepo }) => {
      logRepo.list = () => Promise.reject(new Error('secret internal detail'));
      return send(get('/api/logs'));
    },
  },
];
