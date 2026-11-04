import { ApiError, GenerateContentResponse, type Models } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { buildPrompt } from '../../src/modules/analysis/application/build-prompt.js';
import { requestedResponseSchema } from '../../src/modules/analysis/application/llm-response-schema.js';
import { LlmError } from '../../src/modules/analysis/domain/llm-client.js';
import { GeminiClient } from '../../src/modules/analysis/infrastructure/llm/gemini-client.js';
import type { Log } from '../../src/modules/logs/domain/log.js';

const log: Log = {
  id: 'id-1',
  serviceId: 1,
  level: 'ERROR',
  timestamp: new Date('2026-01-01T00:00:00.000Z'),
  message: 'boom',
  traceId: null,
  metadata: null,
};
const request = buildPrompt([log]);

type FakeModels = Pick<Models, 'generateContent'>;

function response(init: { text?: string; usage?: GenerateContentResponse['usageMetadata'] }): GenerateContentResponse {
  const result = new GenerateContentResponse();
  if (init.text !== undefined) result.candidates = [{ content: { role: 'model', parts: [{ text: init.text }] } }];
  if (init.usage) result.usageMetadata = init.usage;
  return result;
}

function makeClient(generateContent: FakeModels['generateContent']) {
  const models: FakeModels = { generateContent };
  return new GeminiClient({ model: 'gemini-test', models });
}

describe('GeminiClient', () => {
  it('identifies provider and model', () => {
    const client = makeClient(vi.fn());
    expect(client.provider).toBe('gemini');
    expect(client.model).toBe('gemini-test');
  });

  it('sends the model, prompt and JSON-schema config, with no SDK retry options', async () => {
    const generateContent = vi.fn().mockResolvedValue(response({ text: '{}' }));
    const signal = new AbortController().signal;
    await makeClient(generateContent).generate(request, signal);

    expect(generateContent).toHaveBeenCalledTimes(1);
    const params = generateContent.mock.calls[0]?.[0] as Parameters<FakeModels['generateContent']>[0];
    expect(params.model).toBe('gemini-test');
    expect(params.contents).toBe(request.prompt);
    expect(params.config).toMatchObject({
      systemInstruction: request.systemInstruction,
      responseMimeType: 'application/json',
      responseJsonSchema: z.toJSONSchema(requestedResponseSchema),
      temperature: 0.2,
    });
    expect(params.config?.abortSignal).toBe(signal);
    expect(JSON.stringify(params)).not.toContain('retryOptions');
    expect(params.config?.httpOptions).toBeUndefined();
  });

  it('returns the text and maps usage: prompt, and candidates plus thoughts', async () => {
    const client = makeClient(
      vi.fn().mockResolvedValue(
        response({
          text: '{"summary":"x","findings":[]}',
          usage: { promptTokenCount: 100, candidatesTokenCount: 30, thoughtsTokenCount: 12, totalTokenCount: 142 },
        }),
      ),
    );
    await expect(client.generate(request, new AbortController().signal)).resolves.toEqual({
      text: '{"summary":"x","findings":[]}',
      usage: { prompt: 100, completion: 42 },
    });
  });

  it('treats missing token fields as 0 and a missing usageMetadata as null', async () => {
    const partial = await makeClient(
      vi.fn().mockResolvedValue(response({ text: 'x', usage: { promptTokenCount: 7 } })),
    ).generate(request, new AbortController().signal);
    expect(partial.usage).toEqual({ prompt: 7, completion: 0 });

    const none = await makeClient(vi.fn().mockResolvedValue(response({ text: 'x' }))).generate(
      request,
      new AbortController().signal,
    );
    expect(none.usage).toBeNull();
  });

  it('returns an empty string when the response has no text', async () => {
    const result = await makeClient(vi.fn().mockResolvedValue(response({}))).generate(
      request,
      new AbortController().signal,
    );
    expect(result.text).toBe('');
  });

  it.each([
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [400, 'rejected'],
    [401, 'rejected'],
    [403, 'rejected'],
    [404, 'rejected'],
  ])('classifies ApiError %i as %s', async (status, kind) => {
    const client = makeClient(vi.fn().mockRejectedValue(new ApiError({ message: 'nope', status })));
    const error = await client.generate(request, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe(kind);
  });

  it('classifies other failures as network', async () => {
    const client = makeClient(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const error = await client.generate(request, new AbortController().signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).kind).toBe('network');
  });

  it('rethrows the original error when the signal was aborted', async () => {
    const controller = new AbortController();
    const abortError = new DOMException('aborted', 'AbortError');
    const client = makeClient(
      vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.reject(abortError);
      }),
    );
    await expect(client.generate(request, controller.signal)).rejects.toBe(abortError);
  });

  it('does not leak the API error message into a kind-only classification of aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    const client = makeClient(vi.fn().mockRejectedValue(new Error('anything')));
    const error = await client.generate(request, controller.signal).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(LlmError);
  });
});
