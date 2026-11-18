import { afterAll, beforeAll, beforeEach, describe, expect, inject, it, vi } from 'vitest';
import { main, type ProcessIo } from '@/composition/main.js';
import type { Runtime } from '@/composition/create-runtime.js';
import { PrismaAnalysisRepository } from '@/repositories/prisma-analysis.repository.js';
import { createPrismaClient } from '@/shared/db/create-prisma-client.js';
import { okJson, ScriptedLlmClient } from '@tests/support/fakes/scripted-llm-client.js';
import { resetDatabaseWithService } from '@tests/support/integration/database.js';
import { buildIntegrationDeps } from '@tests/support/integration/integration-app.js';

const prisma = createPrismaClient(inject('databaseUrl'));
const analysisRepo = new PrismaAnalysisRepository(prisma);
const baseEnv = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', LOG_LEVEL: 'silent' };

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDatabaseWithService(prisma);
});

describe('main against Postgres', () => {
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
    const llm = new ScriptedLlmClient(okJson({ summary: 's', findings: [] }));
    const { deps } = buildIntegrationDeps({ prisma, llm, wrapAnalysisRepo: () => analysisRepo });
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
