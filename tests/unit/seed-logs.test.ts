import { describe, expect, it } from 'vitest';
import { LOG_LEVELS } from '../../src/modules/logs/domain/log.js';
import {
  SAMPLE_LOG_COUNT,
  buildSampleLogs,
  type SampleServiceIds,
} from '../../src/modules/logs/infrastructure/seed-logs.js';

const ids: SampleServiceIds = { payments: 11, orders: 22 };
const NOW = new Date('2026-11-04T12:00:00.000Z');

function counterId(): () => string {
  let n = 0;
  return () => `id-${String(++n).padStart(4, '0')}`;
}

const build = () => buildSampleLogs(ids, { newId: counterId(), now: () => NOW });

describe('buildSampleLogs', () => {
  it('returns SAMPLE_LOG_COUNT logs, at most one analysis page (200)', () => {
    const logs = build();

    expect(logs).toHaveLength(SAMPLE_LOG_COUNT);
    expect(SAMPLE_LOG_COUNT).toBeLessThanOrEqual(200);
  });

  it('takes ids from newId, in order, one per log', () => {
    const logs = build();

    expect(logs.map((l) => l.id)).toEqual(
      Array.from({ length: logs.length }, (_, i) => `id-${String(i + 1).padStart(4, '0')}`),
    );
  });

  it('covers every level, ERROR and FATAL included', () => {
    const levels = new Set(build().map((l) => l.level));

    for (const level of LOG_LEVELS) expect(levels).toContain(level);
  });

  it('never places a timestamp after now', () => {
    for (const log of build()) expect(log.timestamp.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it('uses only the given service ids and both of them', () => {
    const used = new Set(build().map((l) => l.serviceId));

    expect(used).toEqual(new Set([ids.payments, ids.orders]));
  });

  it('shares a traceId across 2+ logs, one of them across services, and leaves some without', () => {
    const logs = build();
    const byTrace = new Map<string, Set<number>>();
    let sharedCount = 0;
    for (const log of logs) {
      if (log.traceId === null) continue;
      byTrace.set(log.traceId, (byTrace.get(log.traceId) ?? new Set()).add(log.serviceId));
    }
    for (const traceId of byTrace.keys()) {
      if (logs.filter((l) => l.traceId === traceId).length >= 2) sharedCount++;
    }

    expect(sharedCount).toBeGreaterThanOrEqual(1);
    expect([...byTrace.values()].some((services) => services.size > 1)).toBe(true);
    expect(logs.some((l) => l.traceId === null)).toBe(true);
  });

  it('mixes object metadata with null metadata', () => {
    const logs = build();

    expect(logs.some((l) => l.metadata !== null && typeof l.metadata === 'object')).toBe(true);
    expect(logs.some((l) => l.metadata === null)).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    expect(build()).toEqual(build());
  });

  it('computes timestamps relative to now', () => {
    const later = new Date(NOW.getTime() + 3_600_000);
    const shifted = buildSampleLogs(ids, {
      newId: counterId(),
      now: () => later,
    });

    expect(shifted.map((l) => l.timestamp.getTime())).toEqual(build().map((l) => l.timestamp.getTime() + 3_600_000));
  });
});
