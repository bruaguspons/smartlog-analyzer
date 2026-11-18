import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Inline projects do not inherit the root config, so each one needs the alias.
const alias = [
  { find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL('./src', import.meta.url))}/$1` },
  { find: /^@tests\/(.*)$/, replacement: `${fileURLToPath(new URL('./tests', import.meta.url))}/$1` },
];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
          // Wired modules validate config when imported. An empty URL makes an accidental import from a
          // unit test fail loudly instead of silently reaching a database.
          env: { DATABASE_URL: '' },
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/support/integration/global-setup.ts'],
          setupFiles: ['tests/support/integration/env.ts'],
          // Files share one database, so they must run serially.
          fileParallelism: false,
          // Headroom for container startup (Testcontainers).
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
