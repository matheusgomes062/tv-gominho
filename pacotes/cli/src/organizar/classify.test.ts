import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createJevClient, jevApiKey, JEV_URL, type JevClient, type JevRequest, type JevResponse } from '../jev/client';
import { classifyFiles, pool } from './classify';

const choice = (value: string, confidence = 0.95) => ({ type: 'choice' as const, choice: value, confidence, probabilities: { [value]: confidence } });

/** A Jev that answers from the file names, and records what it was asked. */
function fakeJev(): JevClient & { asked: JevRequest[] } {
  const asked: JevRequest[] = [];
  return {
    asked,
    tokens: 0,
    requests: 0,
    save: async () => {},
    async ask(request): Promise<JevResponse> {
      asked.push(request);
      const state = request.state as { pasta?: string; arquivos?: string[]; arquivo?: string };
      const answers: JevResponse['answers'] = {};
      for (const key of Object.keys(request.questions)) {
        if (key === 'mesmo') answers[key] = { type: 'noul', noul: state.pasta === 'desenhos' ? 0.1 : 0.9 };
        else if (key === 'programa') answers[key] = choice(/goku|dbz/i.test(JSON.stringify(state)) ? 'dragon-ball-z' : 'bob-esponja');
        else if (key.startsWith('papel_')) {
          const name = state.arquivos![Number(key.slice(6))]!;
          answers[key] = choice(/sample/.test(name) ? 'extra' : /volta ja/.test(name) ? 'intervalo_entrada' : 'episodio');
        } else if (key.startsWith('marca_')) answers[key] = choice('tv-globinho');
      }
      return { answers };
    },
  };
}

describe('classifyFiles', () => {
  it('asks the show once per folder of episodes, roles in batches of 20, brands only for clips', async () => {
    const jev = fakeJev();
    const files = [
      ...Array.from({ length: 25 }, (_, i) => `DBZ/DBZ ${String(i + 1).padStart(3, '0')}.avi`),
      'DBZ/sample.avi',
      'vinhetas/volta ja globinho.avi',
    ];
    const result = await classifyFiles(files, jev);
    const kinds = jev.asked.map((request) => Object.keys(request.questions)[0]);
    expect(kinds.filter((kind) => kind === 'programa')).toHaveLength(1); // once per folder with episodes
    expect(JSON.stringify(jev.asked.find((request) => 'mesmo' in request.questions)!.state)).not.toContain('sample');
    expect(kinds.filter((kind) => kind === 'papel_0')).toHaveLength(3); // 26 DBZ files = 2 batches, + 1
    expect(kinds.filter((kind) => kind === 'marca_0')).toHaveLength(1);
    expect(result.find((file) => file.path === 'DBZ/DBZ 007.avi')).toMatchObject({ role: { choice: 'episodio' }, show: { choice: 'dragon-ball-z' } });
    expect(result.find((file) => file.path === 'DBZ/sample.avi')?.show).toBeUndefined();
    expect(result.find((file) => file.path === 'vinhetas/volta ja globinho.avi')).toMatchObject({ brand: { choice: 'tv-globinho' } });
  });

  it('asks the show per file in folders that mix shows', async () => {
    const jev = fakeJev();
    const result = await classifyFiles(['desenhos/Goku 1.avi', 'desenhos/Bob 2.avi'], jev);
    expect(result.map((file) => [file.show?.choice, file.mixedFolder])).toEqual([
      ['dragon-ball-z', true],
      ['bob-esponja', true],
    ]);
  });

  it('runs a pool keeping the order of the results', async () => {
    let running = 0;
    let most = 0;
    const result = await pool([5, 1, 4, 2, 3], 2, async (n) => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running--;
      return n * 10;
    });
    expect(result).toEqual([50, 10, 40, 20, 30]);
    expect(most).toBe(2);
  });
});

describe('createJevClient', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('posts to the API with the key, and caches answers on disk', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'tv-gominho-jev-'));
    try {
      const calls: RequestInit[] = [];
      const fetch = (async (url: string, init: RequestInit) => {
        expect(url).toBe(JEV_URL);
        calls.push(init);
        return ok({ answers: { a: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 100, output_tokens: 1 } });
      }) as unknown as typeof globalThis.fetch;
      const cacheFile = path.join(dir, 'cache', 'jev.json');
      const request: JevRequest = { state: 'x', questions: { a: { type: 'noul', instructions: 'y?' } } };

      const first = await createJevClient({ apiKey: 'k', cacheFile, fetch });
      await first.ask(request);
      await first.ask(request);
      expect(calls).toHaveLength(1);
      expect(first.tokens).toBe(100);
      expect((calls[0]!.headers as Record<string, string>).Authorization).toBe('Bearer k');
      expect(JSON.parse(calls[0]!.body as string)).toMatchObject({ model: 'jev-latest', state: 'x' });
      await first.save();

      const second = await createJevClient({ apiKey: 'k', cacheFile, fetch });
      expect((await second.ask(request)).answers.a).toEqual({ type: 'noul', noul: 0.9 });
      expect(calls).toHaveLength(1);
      expect(second.requests).toBe(0);
      expect(await readFile(cacheFile, 'utf8')).not.toContain('input_tokens');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('retries a busy server and explains a refused key', async () => {
    let calls = 0;
    const busy = (async () => (++calls === 1 ? new Response('busy', { status: 503 }) : ok({ answers: {} }))) as unknown as typeof fetch;
    await (await createJevClient({ apiKey: 'k', fetch: busy })).ask({ state: '', questions: {} });
    expect(calls).toBe(2);

    const refused = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
    await expect((await createJevClient({ apiKey: 'k', fetch: refused })).ask({ state: '', questions: {} })).rejects.toThrow(/TYPESAFE_API_KEY/);
  });

  it('needs a key', () => {
    expect(() => jevApiKey({})).toThrow(/TYPESAFE_API_KEY/);
    expect(jevApiKey({ TYPESAFE_API_KEY: ' abc ' })).toBe('abc');
  });
});
