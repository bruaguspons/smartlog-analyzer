import { createRuntime } from '@/composition/create-runtime.js';
import type { RuntimeDeps } from '@/composition/runtime.types.js';
import { InMemoryAnalysisRepository } from '@/repositories/in-memory-analysis.repository.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
import { InMemoryServiceRepository } from '@/repositories/in-memory-service.repository.js';
import { loadConfig } from '@/shared/config/load-config.js';
import { ScriptedLlmClient } from '@tests/support/fakes/scripted-llm-client.js';
import { defaultScript, INACTIVE_KEY, KEY, NOW, OTHER_KEY, seedLogs, type WorldOptions } from './contract-cases.js';

/** Ids come from one counter so every recorded response is reproducible. */
const sequentialId = () => {
  let counter = 0;
  return () => `0192f1c0-cccc-7000-8000-${String((counter += 1)).padStart(12, '0')}`;
};

/** In-memory fakes with a fixed clock and ids, and a scripted model: the input of every contract world. */
export function buildContractDeps(options: WorldOptions = {}) {
  const logRepo = new InMemoryLogRepository();
  seedLogs(logRepo);
  const analysisRepo = new InMemoryAnalysisRepository();
  const llm = new ScriptedLlmClient(...(options.script ?? defaultScript()));
  const config = loadConfig({
    DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
    LOG_LEVEL: 'silent',
    LLM_MAX_RETRIES: '0',
  });
  const deps: RuntimeDeps = {
    serviceRepo: new InMemoryServiceRepository([
      { id: 7, name: 'payments-api', description: null, apiKey: KEY, isActive: true },
      { id: 8, name: 'orders-api', description: null, apiKey: OTHER_KEY, isActive: true },
      { id: 9, name: 'legacy-api', description: null, apiKey: INACTIVE_KEY, isActive: false },
    ]),
    logRepo,
    analysisRepo,
    llm,
    checkDatabase: options.checkDatabase ?? (() => Promise.resolve()),
    disconnect: () => Promise.resolve(),
    newId: sequentialId(),
    now: () => NOW,
  };
  return { config, deps, logRepo, analysisRepo, llm };
}

/** The real runtime over those fakes. */
export function buildContractRuntime(options: WorldOptions = {}) {
  const { config, deps, logRepo, analysisRepo, llm } = buildContractDeps(options);
  return { runtime: createRuntime(config, deps), logRepo, analysisRepo, llm };
}
