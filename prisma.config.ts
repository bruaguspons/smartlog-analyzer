import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// The Prisma CLI does not load .env on its own. process.env is used instead of env()
// because env() throws when unset, which would break `prisma generate` in the image build.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  schema: 'db/schema.prisma',
  migrations: { path: 'db/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
