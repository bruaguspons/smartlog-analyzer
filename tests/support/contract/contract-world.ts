import { logRepository } from '@/repositories/log.repository.js';
import { analysisRunner } from '@/services/analysis-runner.js';
import { prisma } from '@/shared/db/prisma.js';
import { insertLogs, resetDatabase } from '@tests/support/integration/database.js';
import { scriptedLlm } from '@tests/support/fakes/scripted-llm.js';
import { CONTRACT_LOGS, defaultScript, INACTIVE_KEY, KEY, OTHER_KEY, type WorldOptions } from './contract-cases.js';

/**
 * The state every contract case starts from: the database emptied and refilled with the contract
 * services and logs, and the scripted model rewound to the case's script.
 */
export async function buildContractWorld(options: WorldOptions = {}) {
  await resetDatabase();
  await prisma.service.createMany({
    data: [
      { id: 7, name: 'payments-api', description: null, apiKey: KEY, isActive: true },
      { id: 8, name: 'orders-api', description: null, apiKey: OTHER_KEY, isActive: true },
      { id: 9, name: 'legacy-api', description: null, apiKey: INACTIVE_KEY, isActive: false },
    ],
  });
  await insertLogs(CONTRACT_LOGS);

  const llm = scriptedLlm();
  llm.reset(...(options.script ?? defaultScript()));
  return { runner: analysisRunner, logRepo: logRepository, llm };
}
