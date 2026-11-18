import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Runtime } from '@/composition/create-runtime.js';
import { main, type ProcessIo } from '@/composition/main.js';
import { analysisRepository } from '@/repositories/analysis.repository.js';
import { prisma } from '@/shared/db/prisma.js';
import { resetDatabaseWithService } from '@tests/support/integration/database.js';
import { useFreshRunner } from '@tests/support/integration/integration-app.js';

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDatabaseWithService();
});

describe('main against Postgres', () => {
  const makeIo = () => {
    const io = { exit: vi.fn<(code: number) => void>(), registerShutdown: vi.fn() };
    return io satisfies ProcessIo;
  };

  it('a failing startup exits 1, registers graceful shutdown and never listens', async () => {
    const io = makeIo();
    useFreshRunner();
    vi.spyOn(prisma, '$disconnect').mockResolvedValue();
    vi.spyOn(analysisRepository, 'failAllProcessing').mockRejectedValue(new Error('db down'));
    let created: Runtime | undefined;
    io.registerShutdown.mockImplementation((runtime: Runtime) => {
      created = runtime;
    });

    await main(io);

    expect(io.exit).toHaveBeenCalledWith(1);
    expect(created?.server.listening).toBe(false);
    await created?.close();
  });
});
