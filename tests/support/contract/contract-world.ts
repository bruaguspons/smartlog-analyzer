import type { Runtime } from '@/composition/create-runtime.js';
import { PrismaLogRepository } from '@/repositories/prisma-log.repository.js';
import type { PrismaClient } from '@/shared/db/generated/client.js';
import { ScriptedLlmClient } from '@tests/support/fakes/scripted-llm-client.js';
import { insertLogs, resetDatabase } from '@tests/support/integration/database.js';
import { buildIntegrationRuntime } from '@tests/support/integration/integration-app.js';
import { CONTRACT_LOGS, defaultScript, INACTIVE_KEY, KEY, NOW, OTHER_KEY, type WorldOptions } from './contract-cases.js';

/** Ids come from one counter so every recorded response is reproducible. */
const sequentialId = () => {
  let counter = 0;
  return () => `0192f1c0-cccc-7000-8000-${String((counter += 1)).padStart(12, '0')}`;
};

/**
 * The real runtime over Postgres with a fixed clock and ids and a scripted model: the input of every
 * contract case. The database is emptied and refilled with the contract services and logs first.
 */
export async function buildContractRuntime(prisma: PrismaClient, options: WorldOptions = {}) {
  await resetDatabase(prisma);
  await prisma.service.createMany({
    data: [
      { id: 7, name: 'payments-api', description: null, apiKey: KEY, isActive: true },
      { id: 8, name: 'orders-api', description: null, apiKey: OTHER_KEY, isActive: true },
      { id: 9, name: 'legacy-api', description: null, apiKey: INACTIVE_KEY, isActive: false },
    ],
  });
  await insertLogs(prisma, CONTRACT_LOGS);

  const logRepo = new PrismaLogRepository(prisma);
  const llm = new ScriptedLlmClient(...(options.script ?? defaultScript()));
  const runtime: Runtime = buildIntegrationRuntime({
    prisma,
    llm,
    logRepo,
    newId: sequentialId(),
    now: () => NOW,
    ...(options.checkDatabase && { checkDatabase: options.checkDatabase }),
  });
  return { runtime, logRepo, llm };
}
