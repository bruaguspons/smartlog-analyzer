import type { FastifyInstance } from 'fastify';
import { afterEach } from 'vitest';
import { buildApp } from '@/app/build-app.js';
import { createAnalysisRoutes } from '@/modules/analysis/http/create-analysis-routes.js';
import { InMemoryAnalysisRepository } from '@/modules/analysis/infrastructure/in-memory-analysis-repository.js';
import { AnalysisRunner } from '@/modules/analysis/application/run-analysis/analysis-runner.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';
import type { Service } from '@/modules/services/domain/service.types.js';
import { InMemoryServiceRepository } from '@/modules/services/infrastructure/in-memory-service-repository.js';
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
 * Builds the analysis routes over in-memory fakes and closes everything after each test.
 * Call it inside a `describe`; read `app`, `runner`, `analysisRepo` and `llm` after `build`.
 */
export function useAnalysisApp() {
  let app: FastifyInstance;
  let runner: AnalysisRunner;
  let analysisRepo: InMemoryAnalysisRepository;
  let llm: ScriptedLlmClient;

  function build(logCount: number, ...script: ScriptStep[]) {
    const logRepo = new InMemoryLogRepository();
    for (let n = 1; n <= logCount; n += 1) logRepo.logs.push(makeListLog(n));
    analysisRepo = new InMemoryAnalysisRepository();
    llm = new ScriptedLlmClient(...(script.length > 0 ? script : [okJson({ summary: 'Summary', findings: [] })]));
    runner = new AnalysisRunner({ repo: analysisRepo, llm, policy: { timeoutMs: 30_000, maxRetries: 0 }, now: () => NOW });
    let counter = 0;
    app = buildApp({
      serviceRepository: new InMemoryServiceRepository([active, off]),
      checkDatabase: () => Promise.resolve(),
      apiRoutes: [
        createAnalysisRoutes({ logRepo, analysisRepo, runner, llm, newId: () => analysisId((counter += 1)), now: () => NOW }),
      ],
      logLevel: 'silent',
    });
  }

  afterEach(async () => {
    await runner.shutdown();
    await app.close();
  });

  const post = (payload: unknown = {}, h: Record<string, string> = headers) =>
    app.inject({ method: 'POST', url: '/api/logs/analyze', headers: h, payload: payload as object });
  const get = (id: string, h: Record<string, string> = headers) => app.inject({ method: 'GET', url: `/api/analysis/${id}`, headers: h });
  const body = (res: { json: () => unknown }) => res.json() as AnalysisBody;

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
