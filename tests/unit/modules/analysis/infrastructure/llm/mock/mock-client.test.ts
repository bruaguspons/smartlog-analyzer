import { describe, expect, it } from 'vitest';
import { buildPrompt } from '@/modules/analysis/application/run-analysis/prompt/build-prompt.js';
import { llmResponseSchema } from '@/modules/analysis/application/llm-response/llm-response.schema.js';
import { MockClient } from '@/modules/analysis/infrastructure/llm/mock/mock-client.js';
import type { Log, LogLevel } from '@/modules/logs/domain/log.types.js';

const makeLog = (n: number, level: LogLevel): Log => ({
  id: `id-${n}`,
  serviceId: 1,
  level,
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  message: `message ${n}`,
  traceId: null,
  metadata: null,
});

const generate = async (client: MockClient, logs: Log[], signal = new AbortController().signal) => {
  const result = await client.generate(buildPrompt(logs), signal);
  return { ...result, parsed: llmResponseSchema.parse(JSON.parse(result.text)) };
};

describe('MockClient', () => {
  it('identifies itself as the mock provider and model', () => {
    const client = new MockClient();
    expect(client.provider).toBe('mock');
    expect(client.model).toBe('mock');
  });

  it('is deterministic for the same logs', async () => {
    const logs = [makeLog(1, 'ERROR'), makeLog(2, 'INFO')];
    const a = await generate(new MockClient(), logs);
    const b = await generate(new MockClient(), logs);
    expect(a.text).toBe(b.text);
    expect(a.usage).toEqual(b.usage);
  });

  it('writes the summary in English and mentions the batch size', async () => {
    const { parsed } = await generate(new MockClient(), [makeLog(1, 'INFO'), makeLog(2, 'INFO')]);
    expect(parsed.summary).toMatch(/^Analyzed 2 logs/);
    expect(parsed.summary).not.toMatch(/[áéíóúñ]/);
  });

  it('creates one finding per ERROR/FATAL group with that group refs', async () => {
    const logs = [makeLog(1, 'ERROR'), makeLog(2, 'INFO'), makeLog(3, 'FATAL'), makeLog(4, 'ERROR')];
    const { parsed } = await generate(new MockClient(), logs);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings[0]).toMatchObject({ category: 'APPLICATION_ERROR', severity: 'HIGH', logRefs: [1, 4] });
    expect(parsed.findings[1]).toMatchObject({ category: 'APPLICATION_ERROR', severity: 'CRITICAL', logRefs: [3] });
    expect(parsed.findings[0]?.suggestions.length).toBeGreaterThan(0);
  });

  it('returns no findings when there are no ERROR/FATAL logs', async () => {
    const { parsed } = await generate(new MockClient(), [makeLog(1, 'INFO'), makeLog(2, 'WARN')]);
    expect(parsed.findings).toEqual([]);
  });

  it('reports positive token usage that grows with the batch size', async () => {
    const small = await new MockClient().generate(buildPrompt([makeLog(1, 'ERROR')]), new AbortController().signal);
    const large = await new MockClient().generate(
      buildPrompt([1, 2, 3, 4, 5].map((n) => makeLog(n, 'ERROR'))),
      new AbortController().signal,
    );
    expect(small.usage?.prompt).toBeGreaterThan(0);
    expect(small.usage?.completion).toBeGreaterThan(0);
    expect(large.usage?.prompt).toBeGreaterThan(small.usage?.prompt ?? 0);
    expect(large.usage?.completion).toBeGreaterThan(small.usage?.completion ?? 0);
  });

  it('honors an already aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stop'));
    await expect(new MockClient().generate(buildPrompt([makeLog(1, 'ERROR')]), controller.signal)).rejects.toThrow('stop');
  });

  it('can simulate an invalid response', async () => {
    const result = await new MockClient({ behavior: 'invalid' }).generate(
      buildPrompt([makeLog(1, 'ERROR')]),
      new AbortController().signal,
    );
    expect(() => JSON.parse(result.text) as unknown).toThrow();
    expect(result.usage).not.toBeNull();
  });

  it('can simulate a hang that only ends when aborted', async () => {
    const controller = new AbortController();
    const pending = new MockClient({ behavior: 'timeout' }).generate(buildPrompt([makeLog(1, 'ERROR')]), controller.signal);
    let settled = false;
    const outcome = pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    controller.abort(new Error('timeout'));
    await outcome;
    await expect(pending).rejects.toThrow('timeout');
  });
});
