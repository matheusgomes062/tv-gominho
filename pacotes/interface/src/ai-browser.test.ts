import { ANTHROPIC_URL, BROWSER_ACCESS_HEADER, scanLibrary, type Library, type LibrarySource } from '@tv-gominho/nucleo';
import { beforeAll, describe, expect, it } from 'vitest';
import { BROWSER_INTERVAL_MS, browserAi, ENABLED_ITEM, KEY_ITEM, type KeyStorage } from './sources/ai-browser';

// A fake key: no test calls the real API.
const KEY = 'sk-ant-falsa-0123456789abcdefWXYZ';

const FILES: Record<string, string> = {
  'programas/pinguins/programa.yaml': 'titulo: Pinguins',
  'programas/pinguins/episodios/001.mp4': '',
};
const source = (files: Record<string, string>): LibrarySource => ({ files: Object.keys(files), readText: async (path) => files[path] ?? '' });

let library: Library;
beforeAll(async () => {
  library = await scanLibrary(source(FILES));
});

const PROPOSAL = {
  nome: 'Manhã',
  faixas: [{ inicio: '08:00', fim: '09:00' }],
  dias: ['seg'],
  programas: ['pinguins'],
  comerciais: { proprios: false, a_cada_minutos: 0, por_intervalo: 1, depois_do_episodio: false, vinhetas_no_intervalo: false },
  marca: '',
  epoca: null,
  explicacao: 'Uma hora.',
};

function memoryStorage(initial: Record<string, string> = {}): KeyStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  return { send, calls };
}

const answerWith = (value: unknown, status = 200) => () => new Response(JSON.stringify(value), { status });
const ok = answerWith({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(PROPOSAL) }] });
const on = () => memoryStorage({ [KEY_ITEM]: KEY, [ENABLED_ITEM]: '1' });

describe('browserAi settings', () => {
  it('keeps the key in this browser and shows only its end', async () => {
    const storage = memoryStorage();
    const ai = browserAi({ storage, fetch: fakeFetch(ok).send });
    expect(await ai.status()).toMatchObject({ place: 'browser', key: 'none', enabled: false, available: false, canManage: true });
    expect(await ai.saveKey('não é chave')).toEqual({ ok: false, message: expect.stringMatching(/não parece uma chave/) });
    const saved = await ai.saveKey(`  ${KEY} `);
    expect(saved).toMatchObject({ ok: true, status: { key: 'saved', ending: '…WXYZ', available: false } });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(storage.items.get(KEY_ITEM)).toBe(KEY);
    expect(await ai.setEnabled(true)).toMatchObject({ ok: true, status: { enabled: true, available: true } });
    expect(await ai.removeKey()).toMatchObject({ ok: true, status: { key: 'none', available: false } });
    expect(storage.items.has(KEY_ITEM)).toBe(false);
  });

  it('opened from a file, neither saves nor uses a key, and only offers to remove one stored earlier', async () => {
    const storage = on();
    const { send, calls } = fakeFetch(ok);
    for (const where of [{ protocol: 'file:', origin: 'null' }, { protocol: 'http:', origin: 'null' }]) {
      const ai = browserAi({ storage, fetch: send, ...where });
      expect(await ai.status()).toMatchObject({ key: 'saved', ending: '…WXYZ', fileOrigin: true, available: false });
      expect(await ai.propose({ pedido: 'manhã' }, library)).toMatchObject({ status: 409 });
      expect(await ai.saveKey(KEY)).toMatchObject({ ok: false, message: expect.stringMatching(/file:\/\//) });
      expect(await ai.setEnabled(true)).toMatchObject({ ok: false });
    }
    expect(calls).toHaveLength(0);
    const ai = browserAi({ storage, protocol: 'file:', origin: 'null' });
    expect(await ai.removeKey()).toMatchObject({ ok: true, status: { key: 'none' } });
    expect(storage.items.has(KEY_ITEM)).toBe(false);
    expect(await ai.saveKey(KEY)).toMatchObject({ ok: false });
    expect(storage.items.has(KEY_ITEM)).toBe(false);
  });

  it('says so when the browser keeps nothing, without failing', async () => {
    const broken: KeyStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const ai = browserAi({ storage: broken });
    expect(await ai.status()).toMatchObject({ key: 'none', available: false });
    expect(await ai.saveKey(KEY)).toMatchObject({ ok: false });
    expect((await browserAi({ storage: null }).status())!.canManage).toBe(false);
  });
});

describe('browserAi requests', () => {
  it('makes no call without a key or while off', async () => {
    for (const storage of [memoryStorage(), memoryStorage({ [KEY_ITEM]: KEY }), memoryStorage({ [ENABLED_ITEM]: '1' })]) {
      const { send, calls } = fakeFetch(ok);
      const reply = await browserAi({ storage, fetch: send }).propose({ pedido: 'manhã' }, library);
      expect(reply.status).toBe(409);
      expect(calls).toHaveLength(0);
    }
  });

  it('calls the API directly with the browser header and the key only in x-api-key, and checks the proposal', async () => {
    const { send, calls } = fakeFetch(ok);
    const reply = await browserAi({ storage: on(), fetch: send }).propose({ pedido: 'uma manhã calma', duracoes: { pinguins: 11 } }, library);
    expect(reply.status).toBe(200);
    expect((reply.body as { proposta: { shows: string[] } }).proposta.shows).toEqual(['pinguins']);
    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls as [Call];
    expect(url).toBe(ANTHROPIC_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers[BROWSER_ACCESS_HEADER]).toBe('true');
    expect(headers['x-api-key']).toBe(KEY);
    expect(url).not.toContain(KEY);
    expect(String(init.body)).not.toContain(KEY);
    expect(String(init.body)).toContain('uma manhã calma');
    expect(String(init.body)).not.toContain('.mp4');
  });

  it('never puts the key or the API answer in its errors', async () => {
    for (const status of [400, 401, 403, 429, 500]) {
      const { send } = fakeFetch(answerWith({ error: { message: `invalid x-api-key ${KEY}` } }, status));
      const reply = await browserAi({ storage: on(), fetch: send }).propose({ pedido: 'manhã' }, library);
      expect(reply.status).not.toBe(200);
      // 401/403 of the API are not "this device needs the PIN".
      expect([401, 403]).not.toContain(reply.status);
      expect(JSON.stringify(reply)).not.toContain(KEY);
      expect(JSON.stringify(reply)).not.toContain('invalid');
    }
    const thrown = fakeFetch(() => {
      throw new Error(`failed ${KEY}`);
    });
    const reply = await browserAi({ storage: on(), fetch: thrown.send }).propose({ pedido: 'manhã' }, library);
    expect(reply.status).toBe(504);
    expect(JSON.stringify(reply)).not.toContain(KEY);
  });

  it('turns a proposal that does not fit the library into a message', async () => {
    const { send } = fakeFetch(answerWith({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ ...PROPOSAL, programas: ['naruto'] }) }] }));
    const reply = await browserAi({ storage: on(), fetch: send }).propose({ pedido: 'manhã' }, library);
    expect(reply.status).toBe(422);
  });

  it('checks the request and waits between requests', async () => {
    let clock = 0;
    const { send, calls } = fakeFetch(ok);
    const ai = browserAi({ storage: on(), fetch: send, now: () => clock });
    expect((await ai.propose({ pedido: '  ' }, library)).status).toBe(400);
    expect((await ai.propose({ pedido: 'a'.repeat(501) }, library)).status).toBe(400);
    expect((await ai.propose({ pedido: 'manhã' }, library)).status).toBe(200);
    expect((await ai.propose({ pedido: 'manhã' }, library)).status).toBe(429);
    clock += BROWSER_INTERVAL_MS;
    expect((await ai.propose({ pedido: 'manhã' }, library)).status).toBe(200);
    expect(calls).toHaveLength(2);
  });
});
