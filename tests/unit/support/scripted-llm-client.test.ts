import { describe, expect, it } from 'vitest';
import type { LlmRequest } from '@/llm/llm-client.js';
import { hangUntilAborted, okJson, ScriptedLlmClient } from '@tests/support/fakes/scripted-llm-client.js';

const request: LlmRequest = { systemInstruction: 's', prompt: 'p', entries: [] };
const signal = () => new AbortController().signal;

describe('ScriptedLlmClient', () => {
  it('identifies itself as the scripted provider', () => {
    const client = new ScriptedLlmClient(okJson({}));
    expect(client.provider).toBe('scripted');
  });

  it('replays one step per call and repeats the last one', async () => {
    const client = new ScriptedLlmClient(okJson({ n: 1 }), okJson({ n: 2 }));
    expect((await client.generate(request, signal())).text).toBe('{"n":1}');
    expect((await client.generate(request, signal())).text).toBe('{"n":2}');
    expect((await client.generate(request, signal())).text).toBe('{"n":2}');
    expect(client.calls).toBe(3);
  });

  it('rejects a step that is an error', async () => {
    const client = new ScriptedLlmClient(new Error('boom'));
    await expect(client.generate(request, signal())).rejects.toThrow('boom');
  });

  describe('reset', () => {
    it('replaces the script and forgets the recorded requests', async () => {
      const client = new ScriptedLlmClient(okJson({ n: 1 }));
      await client.generate(request, signal());

      client.reset(okJson({ n: 2 }));

      expect(client.calls).toBe(0);
      expect((await client.generate(request, signal())).text).toBe('{"n":2}');
    });

    it('fails on a call made before any script is set', () => {
      const client = new ScriptedLlmClient();
      expect(() => client.generate(request, signal())).toThrow(/no script/i);
    });
  });

  describe('releaseHanging', () => {
    it('settles every call that is still waiting on its signal', async () => {
      const client = new ScriptedLlmClient(hangUntilAborted);
      const first = client.generate(request, signal());
      const second = client.generate(request, signal());
      const outcomes = Promise.allSettled([first, second]);

      client.releaseHanging();

      const settled = await outcomes;
      expect(settled.map((s) => s.status)).toEqual(['rejected', 'rejected']);
    });

    it('does nothing when no call is hanging', () => {
      const client = new ScriptedLlmClient(okJson({}));
      expect(() => {
        client.releaseHanging();
      }).not.toThrow();
    });
  });
});
