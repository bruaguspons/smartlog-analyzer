import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/integration/global-setup.ts'],
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
