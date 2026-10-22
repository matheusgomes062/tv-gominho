import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODEL, ANTHROPIC_URL, ANTHROPIC_VERSION, anthropicApiKey, anthropicUrl, createAnthropicProvider, MAX_TOKENS, RETRIES } from './anthropic';
import { IaError } from './provider';

const KEY = 'sk-ant-test-0123456789-secret';
const REQUEST = { system: 'instruções', prompt: '<pedido>"manhã"</pedido>', schema: { type: 'object' } };
const ANSWER = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"nome":"x"}' }] };

interface Call {
  url: string;
  init: RequestInit;
}

/** A fetch that answers from a list, recording each call. */
function fakeFetch(...answers: Array<Response | Error>) {
  const calls: Call[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.shift() ?? new Response('{}', { status: 500 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { send, calls };
}

const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers });
const noSleep = async () => {};

/** The error a promise fails with. */
async function failure(promise: Promise<unknown>): Promise<IaError> {
  try {
    await promise;
  } catch (error) {
    return error as IaError;
  }
  throw new Error('expected a failure');
}

describe('createAnthropicProvider', () => {
  it('sends one Messages request with the key in a header, the latest model and a JSON schema output', async () => {
    const { send, calls } = fakeFetch(json(ANSWER));
    const provider = createAnthropicProvider({ apiKey: KEY, fetch: send, sleep: noSleep });
    expect(await provider.propose(REQUEST)).toBe('{"nome":"x"}');
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [Call];
    expect(url).toBe(ANTHROPIC_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(KEY);
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
    expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_TOKENS,
      system: 'instruções',
      messages: [{ role: 'user', content: REQUEST.prompt }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: { type: 'object' } } },
      fallbacks: 'default',
    });
    // The key never goes in the URL or the body.
    expect(url).not.toContain(KEY);
    expect(init.body).not.toContain(KEY);
    expect(ANTHROPIC_MODEL).toBe('claude-opus-5-5');
  });

  it('takes another model, without the fallback the model may not support', async () => {
    const { send, calls } = fakeFetch(json(ANSWER));
    const provider = createAnthropicProvider({ apiKey: KEY, model: 'claude-haiku-5-5', fetch: send });
    await provider.propose(REQUEST);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.fallbacks).toBeUndefined();
    expect((calls[0]!.init.headers as Record<string, string>)['anthropic-beta']).toBeUndefined();
  });

  it('retries a busy or failing API, then gives up with a message of its own', async () => {
    const { send, calls } = fakeFetch(json({}, 529), json({}, 429, { 'retry-after': '1' }), json(ANSWER));
    const waits: number[] = [];
    const provider = createAnthropicProvider({ apiKey: KEY, fetch: send, sleep: async (ms) => void waits.push(ms) });
    expect(await provider.propose(REQUEST)).toBe('{"nome":"x"}');
    expect(calls).toHaveLength(3);
    expect(waits).toEqual([1000, 1000]);

    const failing = fakeFetch(...Array.from({ length: RETRIES + 1 }, () => json({ error: { message: 'overloaded' } }, 500)));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, fetch: failing.send, sleep: noSleep }).propose(REQUEST));
    expect(failing.calls).toHaveLength(RETRIES + 1);
    expect(error).toBeInstanceOf(IaError);
    expect(error.message).not.toContain('overloaded');
  });

  it('retries network failures and timeouts, then says so', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const { send, calls } = fakeFetch(timeout, timeout, timeout);
    const error = await failure(createAnthropicProvider({ apiKey: KEY, fetch: send, sleep: noSleep }).propose(REQUEST));
    expect(calls).toHaveLength(RETRIES + 1);
    expect(error.status).toBe(504);
    expect(error.message).toContain('demorou');
  });

  it('gives up on a timed-out request', async () => {
    const hang = (async (_url: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    const error = await failure(createAnthropicProvider({ apiKey: KEY, fetch: hang, sleep: noSleep, timeoutMs: 5 }).propose(REQUEST));
    expect(error.status).toBe(504);
  });

  it('never puts the key or the answer of the API in its errors', async () => {
    for (const status of [400, 401, 402, 403, 404, 429, 500]) {
      const echo = json({ error: { message: `invalid x-api-key ${KEY}` } }, status);
      const { send } = fakeFetch(echo, echo, echo);
      const error = await failure(createAnthropicProvider({ apiKey: KEY, fetch: send, sleep: noSleep }).propose(REQUEST));
      expect(error).toBeInstanceOf(IaError);
      expect(error.message).not.toContain(KEY);
      expect(error.message).not.toContain('invalid');
      expect(String(error.stack)).not.toContain(KEY);
    }
    const { send } = fakeFetch(new Error(`connect failed ${KEY}`), new Error(`connect failed ${KEY}`), new Error(`connect failed ${KEY}`));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, fetch: send, sleep: noSleep }).propose(REQUEST));
    expect(error.message).not.toContain(KEY);
  });

  it('turns a refusal or a cut answer into a message', async () => {
    const refused = fakeFetch(json({ stop_reason: 'refusal', content: [] }));
    expect((await failure(createAnthropicProvider({ apiKey: KEY, fetch: refused.send }).propose(REQUEST))).status).toBe(422);
    const cut = fakeFetch(json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"no' }] }));
    expect((await failure(createAnthropicProvider({ apiKey: KEY, fetch: cut.send }).propose(REQUEST))).message).toContain('incompleta');
    const empty = fakeFetch(json({ stop_reason: 'end_turn', content: [] }));
    expect(await failure(createAnthropicProvider({ apiKey: KEY, fetch: empty.send }).propose(REQUEST))).toBeInstanceOf(IaError);
  });
});

describe('environment', () => {
  it('reads the key from ANTHROPIC_API_KEY only', () => {
    expect(anthropicApiKey({})).toBeUndefined();
    expect(anthropicApiKey({ ANTHROPIC_API_KEY: '  ' })).toBeUndefined();
    expect(anthropicApiKey({ ANTHROPIC_API_KEY: ` ${KEY} ` })).toBe(KEY);
  });

  it('takes a development URL only over https or on this computer', () => {
    expect(anthropicUrl({})).toBeUndefined();
    expect(anthropicUrl({ TV_GOMINHO_IA_URL: 'http://127.0.0.1:9999/v1/messages' })).toBe('http://127.0.0.1:9999/v1/messages');
    expect(anthropicUrl({ TV_GOMINHO_IA_URL: 'https://proxy.example/v1/messages' })).toBe('https://proxy.example/v1/messages');
    expect(() => anthropicUrl({ TV_GOMINHO_IA_URL: 'http://192.168.0.10/v1/messages' })).toThrow(IaError);
    expect(() => anthropicUrl({ TV_GOMINHO_IA_URL: 'nada' })).toThrow(IaError);
  });
});
