import type { Log } from '@/models/log.js';
import { PrismaLogRepository } from '@/repositories/prisma-log.repository.js';
import type { PrismaClient } from '@/shared/db/generated/client.js';

/** The API key of the single service `resetDatabaseWithService` creates. */
export const API_KEY = 'key-1';

/** Empties every table and restarts the id sequences, so each test starts from a blank database. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE finding_logs, analysis_findings, analysis_logs, analyses, logs, services RESTART IDENTITY CASCADE`;
}

/** Empties every table and recreates the single active service `key-1` (id 1). */
export async function resetDatabaseWithService(prisma: PrismaClient): Promise<void> {
  await resetDatabase(prisma);
  await prisma.service.create({ data: { name: 'svc', apiKey: API_KEY } });
}

/** Stores the given logs (their services must exist). */
export async function insertLogs(prisma: PrismaClient, logs: readonly Log[]): Promise<void> {
  const repository = new PrismaLogRepository(prisma);
  for (const log of logs) await repository.create(log);
}

export interface AfterEachTargets {
  /** The scripted client: its hung calls are released first. */
  llm: { releaseHanging(): void };
  /** The runner whose in-flight jobs must finish before the next test touches the database. */
  runner: { idle(): Promise<void> };
}

/** For `afterEach`: frees hung LLM calls, then waits until no analysis job is still writing. */
export async function settleAnalyses({ llm, runner }: AfterEachTargets): Promise<void> {
  llm.releaseHanging();
  await runner.idle();
}
