import { hasNul } from './has-nul.js';

export const noNul = (value: unknown): boolean => !hasNul(value);
