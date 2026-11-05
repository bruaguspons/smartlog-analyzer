import { describe, expect, it, vi } from 'vitest';
import { ingestLog } from '@/modules/logs/application/ingest-log/ingest-log.js';
import type { Log } from '@/modules/logs/domain/log.types.js';
import type { LogRepository } from '@/modules/logs/domain/log-repository.types.js';
import { InMemoryLogRepository } from '@/modules/logs/infrastructure/in-memory-log-repository.js';

const base = { serviceId: 7, level: 'INFO', timestamp: new Date('2026-11-03T10:00:00Z'), message: 'hi' } as const;

describe('ingestLog', () => {
  it('takes the id from newId and the serviceId from the command', async () => {
    const repo = new InMemoryLogRepository();

    const log = await ingestLog(base, { repo, newId: () => 'X' });

    expect(log.id).toBe('X');
    expect(log.serviceId).toBe(7);
    expect(repo.logs).toEqual([log]);
  });

  it('normalizes absent optionals to null', async () => {
    const log = await ingestLog(base, { repo: new InMemoryLogRepository(), newId: () => 'X' });

    expect(log.traceId).toBeNull();
    expect(log.metadata).toBeNull();
  });

  it('keeps provided optionals', async () => {
    const log = await ingestLog(
      { ...base, traceId: 't', metadata: { a: 1 } },
      { repo: new InMemoryLogRepository(), newId: () => 'X' },
    );

    expect(log).toMatchObject({ traceId: 't', metadata: { a: 1 } });
  });

  it('calls repo.create exactly once', async () => {
    const create = vi.fn((l: Log) => Promise.resolve(l));
    const repo: LogRepository = {
      create,
      list: () => Promise.reject(new Error('not used')),
      countByServiceAndLevel: () => Promise.reject(new Error('not used')),
    };

    await ingestLog(base, { repo, newId: () => 'X' });

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propagates repository errors', async () => {
    const repo: LogRepository = {
      create: () => Promise.reject(new Error('db down')),
      list: () => Promise.reject(new Error('not used')),
      countByServiceAndLevel: () => Promise.reject(new Error('not used')),
    };

    await expect(ingestLog(base, { repo, newId: () => 'X' })).rejects.toThrow('db down');
  });
});
