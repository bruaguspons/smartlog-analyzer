import { describe, expect, it, vi } from 'vitest';
import { runSeed } from '@/seed/run-seed.js';
import type { SeedRunDeps } from '@/seed/run-seed.types.js';
import type { PrismaClient } from '@/shared/db/generated/client.js';

function fixture(seed: SeedRunDeps['seed'] = () => Promise.resolve(12)) {
  const disconnect = vi.fn(() => Promise.resolve());
  const createPrisma = vi.fn(() => ({ $disconnect: disconnect }) as unknown as PrismaClient);
  const seedFn = vi.fn(seed);
  const log = vi.fn();
  return { disconnect, createPrisma, seedFn, log, deps: { createPrisma, seed: seedFn, log } };
}
const config = { databaseUrl: 'postgresql://x', seedOnStart: true };

describe('runSeed', () => {
  it('SEED_ON_START=false neither connects nor seeds', async () => {
    const f = fixture();

    await runSeed({ ...config, seedOnStart: false }, f.deps);

    expect(f.createPrisma).not.toHaveBeenCalled();
    expect(f.seedFn).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledWith(expect.stringContaining('skipping'));
  });

  it('SEED_ON_START=true seeds once with the configured database and reports the count', async () => {
    const f = fixture();

    await runSeed(config, f.deps);

    expect(f.createPrisma).toHaveBeenCalledWith('postgresql://x');
    expect(f.seedFn).toHaveBeenCalledOnce();
    expect(f.log).toHaveBeenCalledWith('Seed completed (12 sample logs)');
    expect(f.disconnect).toHaveBeenCalledOnce();
  });

  it('releases the pool and rethrows when the seed fails', async () => {
    const f = fixture(() => Promise.reject(new Error('boom')));

    await expect(runSeed(config, f.deps)).rejects.toThrow('boom');

    expect(f.disconnect).toHaveBeenCalledOnce();
  });
});
