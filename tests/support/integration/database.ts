import type { PrismaClient } from '@/shared/db/generated/client.js';

/** Empties every table and restarts the id sequences, so each test starts from a blank database. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`TRUNCATE finding_logs, analysis_findings, analysis_logs, analyses, logs, services RESTART IDENTITY CASCADE`;
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
