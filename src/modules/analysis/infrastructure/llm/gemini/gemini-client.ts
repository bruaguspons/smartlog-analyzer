import { ApiError, GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { requestedResponseSchema } from '@/modules/analysis/application/llm-response/requested-response.schema.js';
import type { LlmClient, LlmErrorKind, LlmRequest, LlmResult } from '@/modules/analysis/domain/llm-client.types.js';
import { LlmError } from '@/modules/analysis/domain/llm-error.js';
import type { GeminiClientOptions, GeminiModels } from './gemini-client.types.js';

const TEMPERATURE = 0.2;
const RESPONSE_JSON_SCHEMA = z.toJSONSchema(requestedResponseSchema);

function classify(status: number): LlmErrorKind {
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'unavailable';
  return 'rejected';
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Gemini adapter. Retries and timeouts belong to `callWithRetry`, so the SDK is built without
 * `retryOptions` (a single attempt per call) and receives the attempt's AbortSignal.
 * Failure messages never include the SDK error text, which could echo request details.
 */
export class GeminiClient implements LlmClient {
  readonly provider = 'gemini';
  readonly model: string;
  private readonly models: GeminiModels;

  constructor(options: GeminiClientOptions) {
    this.model = options.model;
    this.models = 'models' in options ? options.models : new GoogleGenAI({ apiKey: options.apiKey }).models;
  }

  async generate(request: LlmRequest, signal: AbortSignal): Promise<LlmResult> {
    let response;
    try {
      response = await this.models.generateContent({
        model: this.model,
        contents: request.prompt,
        config: {
          systemInstruction: request.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          abortSignal: signal,
          temperature: TEMPERATURE,
        },
      });
    } catch (error) {
      if (signal.aborted || isAbort(error)) throw error;
      if (error instanceof ApiError) {
        throw new LlmError(classify(error.status), `Gemini API responded with HTTP ${String(error.status)}`, {
          cause: error,
        });
      }
      throw new LlmError('network', 'Gemini request failed before a response was received', { cause: error });
    }

    const usage = response.usageMetadata;
    return {
      text: response.text ?? '',
      usage: usage
        ? {
            prompt: usage.promptTokenCount ?? 0,
            completion: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          }
        : null,
    };
  }
}
