import { inject } from 'vitest';

// Runs before each integration test file imports anything, so modules that read the
// environment when they load (config, Prisma client, logger) see the test values.
process.env.DATABASE_URL = inject('databaseUrl');
process.env.LOG_LEVEL = 'silent';
process.env.LLM_PROVIDER = 'mock';
process.env.LLM_MAX_RETRIES = '0';
process.env.SEED_ON_START = 'false';
