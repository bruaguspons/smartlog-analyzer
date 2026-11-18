import request from 'supertest';
import { afterEach } from 'vitest';
import type { Express } from 'express';
import { createRuntime, type Runtime } from '@/composition/create-runtime.js';
import { loadConfig } from '@/shared/config/load-config.js';
import { InMemoryAnalysisRepository } from '@/repositories/in-memory-analysis.repository.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
import { InMemoryServiceRepository } from '@/repositories/in-memory-service.repository.js';
import type { AnalysisRunner } from '@/services/analysis-runner.js';
import type { Service } from '@/models/service.js';
import { analysisId } from '@tests/support/contracts/analysis-repository-contract.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';
import { okJson, ScriptedLlmClient, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';

export const NOW = new Date('2026-11-04T12:00:00.000Z');
const active: Service = { id: 7, name: 'svc', description: null, apiKey: 'k-active', isActive: true };
const off: Service = { id: 8, name: 'off', description: null, apiKey: 'k-off', isActive: false };
export const headers = { 'x-api-key': 'k-active' };

export interface AnalysisBody {
  id: string;
  hasMore: boolean;
  nextCursor: string | null;
  status: string;
  durationMs: number | null;
  summary: string | null;
  findings: { logIds: string[] }[];
  tokens: unknown;
  error: { code: string } | null;
  details?: unknown;
}

/**
 * Builds the analysis endpoints over in-memory fakes and closes the runtime after each test.
 * Call it inside a `describe`; read `app`, `runner`, `analysisRepo` and `llm` after `build`.
 */
export function useAnalysisApp() {
  let runtime: Runtime;
  let app: Express;
  let runner: AnalysisRunner;
  let analysisRepo: InMemoryAnalysisRepository;
  let llm: ScriptedLlmClient;

  function build(logCount: number, ...script: ScriptStep[]) {
    const logRepo = new InMemoryLogRepository();
    for (let n = 1; n <= logCount; n += 1) logRepo.logs.push(makeListLog(n));
    analysisRepo = new InMemoryAnalysisRepository();
    llm = new ScriptedLlmClient(...(script.length > 0 ? script : [okJson({ summary: 'Summary', findings: [] })]));
    let counter = 0;
    runtime = createRuntime(
      loadConfig({ DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused', LOG_LEVEL: 'silent', LLM_MAX_RETRIES: '0' }),
      {
        serviceRepo: new InMemoryServiceRepository([active, off]),
        logRepo,
        analysisRepo,
        llm,
        checkDatabase: () => Promise.resolve(),
        disconnect: () => Promise.resolve(),
        newId: () => analysisId((counter += 1)),
        now: () => NOW,
      },
    );
    ({ app, runner } = runtime);
  }

  afterEach(async () => {
    await runtime.close();
  });

  const post = (payload: object = {}, h: Record<string, string> = headers) =>
    request(app).post('/api/logs/analyze').set(h).send(payload);
  const get = (id: string, h: Record<string, string> = headers) => request(app).get(`/api/analysis/${id}`).set(h);
  const body = (res: { body: unknown }) => res.body as AnalysisBody;

  return {
    build,
    post,
    get,
    body,
    get app() {
      return app;
    },
    get runner() {
      return runner;
    },
    get analysisRepo() {
      return analysisRepo;
    },
    get llm() {
      return llm;
    },
  };
}
