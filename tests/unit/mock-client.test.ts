import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../../src/modules/analysis/application/build-prompt.js';
import { llmResponseSchema } from '../../src/modules/analysis/application/llm-response-schema.js';
import { MockClient } from '../../src/modules/analysis/infrastructure/llm/mock-client.js';
import type { Log, LogLevel } from '../../src/modules/logs/domain/log.js';
import { ScriptedLlmClient, okJson } from '../shared/scripted-llm-client.js';

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

  it('S20: is deterministic for the same logs', async () => {
    const logs = [makeLog(1, 'ERROR'), makeLog(2, 'INFO')];
    const a = await generate(new MockClient(), logs);
    const b = await generate(new MockClient(), logs);
    expect(a.text).toBe(b.text);
    expect(a.usage).toEqual(b.usage);
  });

  it('writes the summary in Spanish and mentions the batch size', async () => {
    const { parsed } = await generate(new MockClient(), [makeLog(1, 'INFO'), makeLog(2, 'INFO')]);
    expect(parsed.summary).toMatch(/Se analizaron 2 logs/);
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

  it('reports usage as ceil(chars / 4) of the request and the response', async () => {
    const request = buildPrompt([makeLog(1, 'ERROR')]);
    const result = await new MockClient().generate(request, new AbortController().signal);
    expect(result.usage).toEqual({
      prompt: Math.ceil((request.systemInstruction.length + request.prompt.length) / 4),
      completion: Math.ceil(result.text.length / 4),
    });
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

describe('ScriptedLlmClient', () => {
  const request = buildPrompt([makeLog(1, 'ERROR')]);
  const signal = new AbortController().signal;

  it('replays steps in order, repeats the last one and records requests', async () => {
    const client = new ScriptedLlmClient(okJson({ a: 1 }), new Error('boom'));
    await expect(client.generate(request, signal)).resolves.toMatchObject({ text: '{"a":1}' });
    await expect(client.generate(request, signal)).rejects.toThrow('boom');
    await expect(client.generate(request, signal)).rejects.toThrow('boom');
    expect(client.calls).toBe(3);
    expect(client.requests[0]).toBe(request);
  });

  it('supports function steps', async () => {
    const client = new ScriptedLlmClient(() => Promise.resolve({ text: 'x', usage: null }));
    await expect(client.generate(request, signal)).resolves.toEqual({ text: 'x', usage: null });
  });
});
