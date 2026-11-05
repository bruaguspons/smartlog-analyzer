import type { LlmRequest, NumberedLog } from '@/modules/analysis/domain/llm-client.types.js';
import type { Log } from '@/modules/logs/domain/log.types.js';
import { MAX_MESSAGE_CHARS, MAX_METADATA_CHARS, SYSTEM_INSTRUCTION } from './prompt.const.js';

const ELLIPSIS = '…';

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) + ELLIPSIS : value;
}

/** `<` is escaped so no log content can reproduce the closing delimiter. */
function renderEntry({ ref, log }: NumberedLog): string {
  const line = JSON.stringify({
    n: ref,
    level: log.level,
    timestamp: log.timestamp.toISOString(),
    serviceId: log.serviceId,
    traceId: log.traceId,
    message: truncate(log.message, MAX_MESSAGE_CHARS),
    metadata: log.metadata === null ? null : truncate(JSON.stringify(log.metadata), MAX_METADATA_CHARS),
  });
  return line.replaceAll('<', '\\u003c');
}

/** Builds the request for one batch; log `i` (0-based) is presented as number `i + 1`. */
export function buildPrompt(logs: readonly Log[]): LlmRequest {
  const entries: NumberedLog[] = logs.map((log, index) => ({ ref: index + 1, log }));
  const prompt = ['<logs>', ...entries.map(renderEntry), '</logs>'].join('\n');
  return { systemInstruction: SYSTEM_INSTRUCTION, prompt, entries };
}
