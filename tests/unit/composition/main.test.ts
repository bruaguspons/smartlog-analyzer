import { describe, expect, it, vi } from 'vitest';
import { main, type ProcessIo } from '@/composition/main.js';
import type { Runtime, RuntimeDeps } from '@/composition/create-runtime.js';
import { InMemoryAnalysisRepository } from '@/repositories/in-memory-analysis.repository.js';
import { InMemoryLogRepository } from '@/repositories/in-memory-log.repository.js';
import type { Service } from '@/models/service.js';
import { InMemoryServiceRepository } from '@/repositories/in-memory-service.repository.js';
import { makeListLog } from '@tests/support/contracts/log-repository-list-contract.js';
import { okJson, ScriptedLlmClient, type ScriptStep } from '@tests/support/fakes/scripted-llm-client.js';

const service: Service = { id: 1, name: 'svc', description: null, apiKey: 'k', isActive: true };

function fixture(...script: ScriptStep[]) {
  const analysisRepo = new InMemoryAnalysisRepository();
  const logRepo = new InMemoryLogRepository();
  logRepo.logs.push(makeListLog(1), makeListLog(2));
  const llm = new ScriptedLlmClient(...(script.length > 0 ? script : [okJson({ summary: 's', findings: [] })]));
  const disconnect = vi.fn<() => Promise<void>>(() => Promise.resolve());
  const deps: RuntimeDeps = {
    serviceRepo: new InMemoryServiceRepository([service]),
    logRepo,
    analysisRepo,
    llm,
    checkDatabase: () => Promise.resolve(),
    disconnect,
  };
  return { analysisRepo, llm, disconnect, deps };
}

const baseEnv = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', LOG_LEVEL: 'silent' };

describe('main', () => {
  const makeIo = () => {
    const io = { exit: vi.fn<(code: number) => void>(), error: vi.fn<(m: string) => void>(), registerShutdown: vi.fn() };
    return io satisfies ProcessIo;
  };

  it('LLM_PROVIDER=gemini without a key reports the error, exits 1 and builds nothing', async () => {
    const io = makeIo();
    const makeDeps = vi.fn();

    await main({ ...baseEnv, LLM_PROVIDER: 'gemini' }, io, makeDeps);

    expect(io.error).toHaveBeenCalledWith(expect.stringContaining('GEMINI_API_KEY'));
    expect(io.exit).toHaveBeenCalledWith(1);
    expect(makeDeps).not.toHaveBeenCalled();
    expect(io.registerShutdown).not.toHaveBeenCalled();
  });

  it('a failing startup exits 1, registers graceful shutdown and never listens', async () => {
    const io = makeIo();
    const { analysisRepo, deps } = fixture();
    vi.spyOn(analysisRepo, 'failAllProcessing').mockRejectedValue(new Error('db down'));
    let created: Runtime | undefined;
    io.registerShutdown.mockImplementation((runtime: Runtime) => {
      created = runtime;
    });

    await main({ ...baseEnv, PORT: '3999' }, io, () => deps);

    expect(io.exit).toHaveBeenCalledWith(1);
    expect(created?.server.listening).toBe(false);
    await created?.close();
  });
});
