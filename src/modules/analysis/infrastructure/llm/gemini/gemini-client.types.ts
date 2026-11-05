import type { Models } from '@google/genai';

export type GeminiModels = Pick<Models, 'generateContent'>;

export type GeminiClientOptions = { model: string } & ({ apiKey: string } | { models: GeminiModels });
