import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { RouteDefinition } from '@/routes/mount-routes.js';
import { buildTestApp } from '@tests/support/apps/express-test-app.js';

const echo: RouteDefinition = {
  method: 'post',
  path: '/echo',
  summary: 'echoes the parsed body',
  tags: [],
  public: true,
  request: { body: z.unknown() },
  responses: { 200: z.unknown() },
  handler: (req, res) => {
    const body: unknown = req.body;
    res.json({ received: body === undefined ? 'nothing' : body });
  },
};
const app = () => buildTestApp({ routes: [echo] });
const post = () => request(app()).post('/api/echo');
const code = (res: { body: unknown }) => (res.body as { error: { code: string; message: string } }).error;

describe('parseJsonBody', () => {
  it('reads application/json in any case and with a charset', async () => {
    for (const type of ['application/json', 'Application/JSON', 'application/json; charset=utf-8']) {
      const res = await post().set('Content-Type', type).send('{"a":1}');
      expect(res.body).toEqual({ received: { a: 1 } });
    }
  });

  it('accepts a bare JSON null (validation, not parsing, rejects it)', async () => {
    const res = await post().set('Content-Type', 'application/json').send('null');
    expect(res.body).toEqual({ received: null });
  });

  it('keeps text/plain as a string', async () => {
    const res = await post().set('Content-Type', 'text/plain').send('hello');
    expect(res.body).toEqual({ received: 'hello' });
  });

  it('a body of another type is 415, including vendor +json', async () => {
    for (const type of ['text/xml', 'application/vnd.api+json', 'application/x-www-form-urlencoded']) {
      const res = await post().set('Content-Type', type).send('x=1');
      expect(res.status).toBe(415);
      expect(code(res)).toEqual({ code: 'VALIDATION_ERROR', message: 'Unsupported Media Type' });
    }
  });

  it('a body without content type is 415', async () => {
    const res = await post().unset('Content-Type').send(Buffer.from('{"a":1}'));
    expect(res.status).toBe(415);
  });

  it('no body and no content type goes through untouched', async () => {
    const res = await post().unset('Content-Type');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: 'nothing' });
  });

  it('an empty JSON body is 400', async () => {
    const res = await post().set('Content-Type', 'application/json').send('');
    expect(res.status).toBe(400);
    expect(code(res).message).toBe("Body cannot be empty when content-type is set to 'application/json'");
  });

  it('malformed JSON is 400 with the fixed message', async () => {
    const res = await post().set('Content-Type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(code(res).message).toBe("Body is not valid JSON but content-type is set to 'application/json'");
  });

  it.each([
    ['__proto__ at the top', '{"__proto__":{"x":1}}'],
    ['__proto__ nested', '{"a":{"__proto__":{"x":1}}}'],
    ['constructor.prototype', '{"constructor":{"prototype":{"x":1}}}'],
  ])('rejects prototype poisoning (%s) as malformed JSON', async (_name, payload) => {
    const res = await post().set('Content-Type', 'application/json').send(payload);
    expect(res.status).toBe(400);
    expect(code(res).message).toContain('not valid JSON');
  });

  it('a constructor key without a prototype key is fine', async () => {
    const res = await post().set('Content-Type', 'application/json').send('{"constructor":{"name":"x"}}');
    expect(res.status).toBe(200);
  });

  it('a body over 1 MiB is 413, exactly 1 MiB is accepted', async () => {
    const over = await post().set('Content-Type', 'application/json').send(JSON.stringify({ a: 'x'.repeat(1_048_576) }));
    expect(over.status).toBe(413);
    expect(code(over)).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' });

    const padding = 1_048_576 - '{"a":""}'.length;
    const exact = await post().set('Content-Type', 'application/json').send(`{"a":"${'x'.repeat(padding)}"}`);
    expect(exact.status).toBe(200);
  });
});
