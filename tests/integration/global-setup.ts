import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  interface ProvidedContext {
    databaseUrl: string;
  }
}

/** One Postgres per run, same image as docker-compose.yml, migrated with the real SQL. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const databaseUrl = container.getConnectionUri();

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env, stdio: 'inherit' });
    // Drift guard: migrations are hand-written, so the migrated DB must match schema.prisma.
    // Exit code 2 means a difference; diffing against the live DB avoids needing a shadow database.
    execFileSync(
      'npx',
      ['prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'db/schema.prisma', '--exit-code'],
      { env, stdio: 'inherit' },
    );
  } catch (err) {
    await container.stop();
    throw err;
  }

  project.provide('databaseUrl', databaseUrl);
  return async () => {
    await container.stop();
  };
}
