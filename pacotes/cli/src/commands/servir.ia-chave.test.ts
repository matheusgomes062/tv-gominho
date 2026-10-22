import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { appDataDir, createKeyStore, KEY_FILE, SETTINGS_FILE } from '../ia/chave';
import type { IaProvider } from '../ia/provider';
import { createAssistant } from '../serve/ia';
import { createIaConfig, isLoopback } from '../serve/ia-config';
import { createLibraryServer } from './servir';

// A fake key: never a real one, and no test calls the API.
const KEY = 'sk-ant-falsa-0123456789abcdefWXYZ';
const ENV_KEY = 'sk-ant-ambiente-0123456789abcdQRST';
const PIN = '112233';
const STATE = '/__tv-gominho/ia/estado';
const CHAVE = '/__tv-gominho/ia/chave';
const LIGADA = '/__tv-gominho/ia/ligada';
const CAPS = '/__tv-gominho/capacidades';
const IA = '/__tv-gominho/ia/proposta';

const PROPOSAL = {
  nome: 'Manhã',
  faixas: [{ inicio: '08:00', fim: '09:00' }],
  dias: ['seg'],
  programas: [],
  comerciais: { proprios: false, a_cada_minutos: 0, por_intervalo: 1, depois_do_episodio: false, vinhetas_no_intervalo: false },
  marca: '',
  epoca: null,
  explicacao: 'Uma hora.',
};

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(host: string, method: string, urlPath: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  const [hostname, port] = host.split(/:(?=\d+$)/);
  return new Promise((resolve, reject) => {
    const req = request({ host: hostname, port: Number(port), method, path: urlPath, headers, setHost: !('host' in headers) }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

let root: string;
let library: string;
let app: string;
const servers: Server[] = [];
const logs: string[] = [];
const keysUsed: string[] = [];

function fakeProvider(key: string): IaProvider {
  return {
    name: 'Falso',
    model: 'falso-1',
    async propose() {
      keysUsed.push(key);
      return JSON.stringify(PROPOSAL);
    },
  };
}

interface StartOptions {
  /** The address the server believes the connection comes from (default: the socket's). */
  remote?: string;
  envKey?: string;
  dataDir?: string;
  listen?: string;
}

async function start(options: StartOptions = {}) {
  const dataDir = options.dataDir ?? (await mkdtemp(path.join(root, 'dados-')));
  const log = (line: string) => logs.push(line);
  const ia = await createIaConfig({
    store: createKeyStore(dataDir),
    library,
    envKey: options.envKey,
    model: 'falso-1',
    provider: fakeProvider,
    log,
    ...(options.remote ? { remoteAddress: () => options.remote } : {}),
  });
  // Each request two hours after the last one: past the assistant's limits.
  let clock = 0;
  const assistant = createAssistant(library, { provider: () => ia.provider(), log, now: () => (clock += 2 * 3600_000) });
  const server = createLibraryServer(library, app, { pin: PIN, log, write: false, assistant, isLocal: ia.isLocal }, ia);
  await new Promise<void>((resolve) => server.listen(0, options.listen ?? '127.0.0.1', resolve));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { host: `127.0.0.1:${port}`, port, dataDir, ia };
}

const json = (host: string, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', origin: `http://${host}`, ...extra });
const putKey = (host: string, key: string, extra: Record<string, string> = {}) => send(host, 'PUT', CHAVE, json(host, extra), JSON.stringify({ chave: key }));
const turn = (host: string, on: boolean, extra: Record<string, string> = {}) => send(host, 'PUT', LIGADA, json(host, extra), JSON.stringify({ ligada: on }));
const state = async (host: string, extra: Record<string, string> = {}) => JSON.parse((await send(host, 'GET', STATE, extra)).body);

/** Everything a client could ever see, to check that the key is in none of it. */
const seen: string[] = [];
const watch = async (reply: Promise<Reply>) => {
  const value = await reply;
  seen.push(value.body, JSON.stringify(value.headers));
  return value;
};

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tv-gominho-chave-'));
  library = path.join(root, 'biblioteca');
  app = path.join(root, 'app');
  await mkdir(path.join(library, 'programas', 'pinguins', 'episodios'), { recursive: true });
  await writeFile(path.join(library, 'programas', 'pinguins', 'episodios', '001.mp4'), '');
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, 'index.html'), '<!doctype html><title>TV</title>');
});

afterEach(() => {
  logs.length = 0;
  keysUsed.length = 0;
});

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(root, { recursive: true, force: true });
  for (const text of seen) {
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(ENV_KEY);
  }
});

describe('appDataDir', () => {
  it('is the app data folder of each system, never a relative path', () => {
    expect(appDataDir({ LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, 'win32', 'C:\\Users\\ana')).toBe('C:\\Users\\ana\\AppData\\Local\\TVGominho');
    expect(appDataDir({}, 'win32', 'C:\\Users\\ana')).toBe('C:\\Users\\ana\\AppData\\Local\\TVGominho');
    expect(appDataDir({ XDG_CONFIG_HOME: '/home/ana/.cfg' }, 'linux', '/home/ana')).toBe('/home/ana/.cfg/tv-gominho');
    expect(appDataDir({ XDG_CONFIG_HOME: 'relativo' }, 'linux', '/home/ana')).toBe('/home/ana/.config/tv-gominho');
    expect(appDataDir({}, 'darwin', '/Users/ana')).toBe('/Users/ana/Library/Application Support/TVGominho');
  });
});

describe('the key store', () => {
  it('saves the key for this user only, reads it back and deletes it', async () => {
    const dir = path.join(root, 'loja', 'TVGominho');
    const store = createKeyStore(dir);
    expect(await store.readKey()).toBeUndefined();
    expect(await store.readEnabled()).toBe(false);
    await store.saveKey(`  ${KEY}\n`);
    expect(await store.readKey()).toBe(KEY);
    if (process.platform !== 'win32') expect((await stat(path.join(dir, KEY_FILE))).mode & 0o777).toBe(0o600);
    await store.saveEnabled(true);
    expect(await store.readEnabled()).toBe(true);
    expect(JSON.parse(await readFile(path.join(dir, SETTINGS_FILE), 'utf8'))).toEqual({ ligada: true });
    expect(await store.removeKey()).toBe(true);
    await expect(stat(path.join(dir, KEY_FILE))).rejects.toThrow();
    expect(await store.removeKey()).toBe(false);
    await expect(store.saveKey('não é chave')).rejects.toThrow();
  });
});

describe('isLoopback', () => {
  it('takes only this computer', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(address)).toBe(true);
    for (const address of ['192.168.0.20', '::ffff:192.168.0.20', '10.0.0.1', 'localhost', '', undefined]) expect(isLoopback(address)).toBe(false);
  });
});

describe('the AI settings of servir, from this computer', () => {
  it('starts with no key and the AI off, and the app can tell it may change them', async () => {
    const { host } = await start();
    expect(await state(host)).toEqual({ chave: 'nenhuma', ligada: false, disponivel: false, local: true, modelo: 'falso-1' });
    expect(JSON.parse((await send(host, 'GET', CAPS)).body)).toEqual({ editar: false, ia: false, pareado: false, configIa: true });
    // With no key the assistant's route makes no call.
    expect((await send(host, 'POST', IA, json(host), JSON.stringify({ pedido: 'manhã' }))).status).toBe(409);
    expect(keysUsed).toEqual([]);
  });

  it('saves a key outside the library, shows only its end, turns on and off and removes it', async () => {
    const { host, dataDir } = await start();
    const saved = await watch(putKey(host, KEY));
    expect(saved.status).toBe(200);
    expect(JSON.parse(saved.body)).toMatchObject({ chave: 'salva', final: '…WXYZ', ligada: false, disponivel: false });
    expect((await readFile(path.join(dataDir, KEY_FILE), 'utf8')).trim()).toBe(KEY);
    expect(path.relative(library, dataDir).startsWith('..')).toBe(true);
    // Saved, but off: still no AI.
    expect(JSON.parse((await watch(send(host, 'GET', CAPS))).body).ia).toBe(false);

    expect(JSON.parse((await watch(turn(host, true))).body)).toMatchObject({ ligada: true, disponivel: true });
    expect(JSON.parse((await watch(send(host, 'GET', CAPS))).body).ia).toBe(true);
    // This computer's browser uses it without the PIN.
    const asked = await watch(send(host, 'POST', IA, json(host), JSON.stringify({ pedido: 'uma manhã' })));
    expect(asked.status).toBe(200);
    expect(keysUsed).toEqual([KEY]);

    expect(JSON.parse((await watch(turn(host, false))).body)).toMatchObject({ ligada: false, disponivel: false });
    expect(JSON.parse(await readFile(path.join(dataDir, SETTINGS_FILE), 'utf8'))).toEqual({ ligada: false });
    await watch(turn(host, true));

    const removed = await watch(send(host, 'DELETE', CHAVE, { origin: `http://${host}` }));
    expect(removed.status).toBe(200);
    expect(JSON.parse(removed.body)).toMatchObject({ chave: 'nenhuma', disponivel: false });
    expect(JSON.parse(removed.body).final).toBeUndefined();
    await expect(stat(path.join(dataDir, KEY_FILE))).rejects.toThrow();
    expect(JSON.parse((await watch(send(host, 'GET', CAPS))).body).ia).toBe(false);
    expect(logs).toContain('IA: chave salva pelo app neste computador.');
    expect(logs).toContain('IA: chave removida deste computador.');
    expect(logs.join('\n')).not.toContain(KEY);
    expect(logs.join('\n')).not.toContain('WXYZ');
  });

  it('keeps a saved key across restarts', async () => {
    const first = await start();
    await putKey(first.host, KEY);
    await turn(first.host, true);
    const again = await start({ dataDir: first.dataDir });
    expect(await state(again.host)).toMatchObject({ chave: 'salva', final: '…WXYZ', ligada: true, disponivel: true });
  });

  it('refuses what is not a key, oversized bodies and other content types, with fixed messages', async () => {
    const { host, dataDir } = await start();
    const bad = await watch(putKey(host, 'sk-ant- com espaço e mais coisas'));
    expect(bad.status).toBe(400);
    expect(bad.body).not.toContain('espaço');
    expect((await watch(putKey(host, ''))).status).toBe(400);
    expect((await watch(send(host, 'PUT', CHAVE, json(host), JSON.stringify({ chave: KEY, resto: 'x'.repeat(4096) })))).status).toBe(413);
    expect((await watch(send(host, 'PUT', CHAVE, { origin: `http://${host}`, 'content-type': 'text/plain' }, KEY))).status).toBe(415);
    expect((await watch(send(host, 'PUT', CHAVE, json(host), `{"chave":"${KEY}"`))).status).toBe(400);
    expect((await watch(send(host, 'PUT', LIGADA, json(host), '{"ligada":"sim"}'))).status).toBe(400);
    expect((await watch(send(host, 'POST', CHAVE, json(host), JSON.stringify({ chave: KEY })))).status).toBe(405);
    await expect(stat(path.join(dataDir, KEY_FILE))).rejects.toThrow();
  });

  it('refuses pages of other sites, even opened on this computer', async () => {
    const { host, dataDir } = await start();
    expect((await watch(putKey(host, KEY, { origin: 'http://malicioso.example.com' }))).status).toBe(403);
    expect((await watch(putKey(host, KEY, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await watch(send(host, 'PUT', CHAVE, { 'content-type': 'application/json' }, JSON.stringify({ chave: KEY })))).status).toBe(403);
    expect((await watch(send(host, 'DELETE', CHAVE, {}))).status).toBe(403);
    // DNS rebinding: a name of another site in Host.
    expect((await watch(putKey(host, KEY, { host: 'malicioso.example.com', origin: 'http://malicioso.example.com' }))).status).toBe(421);
    await expect(stat(path.join(dataDir, KEY_FILE))).rejects.toThrow();
  });
});

describe('the AI settings of servir, from another device', () => {
  it('get 403 with a message to do it on the computer, whatever the headers say', async () => {
    const local = await start();
    await putKey(local.host, KEY);
    await turn(local.host, true);
    const { host, dataDir } = await start({ remote: '192.168.0.20', dataDir: local.dataDir });
    const forged = { host: `localhost:${host.split(':')[1]}`, origin: `http://localhost:${host.split(':')[1]}`, 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1', forwarded: 'for=127.0.0.1' };
    for (const reply of [
      await watch(putKey(host, 'sk-ant-outra-chave-0123456789abcdef', forged)),
      await watch(send(host, 'DELETE', CHAVE, forged)),
      await watch(turn(host, false, forged)),
    ]) {
      expect(reply.status).toBe(403);
      expect(JSON.parse(reply.body).erro).toMatch(/computador que roda o servidor/);
    }
    expect((await readFile(path.join(dataDir, KEY_FILE), 'utf8')).trim()).toBe(KEY);
    // The state, without even the end of the key.
    const seenThere = await state(host, forged);
    expect(seenThere).toEqual({ chave: 'salva', ligada: true, disponivel: true, local: false, modelo: 'falso-1' });
    // Using the AI needs the PIN from there.
    expect((await watch(send(host, 'POST', IA, json(host), JSON.stringify({ pedido: 'manhã' })))).status).toBe(401);
    const pair = await send(host, 'POST', '/__tv-gominho/pareamento', json(host), JSON.stringify({ pin: PIN }));
    const cookie = String(pair.headers['set-cookie']).split(';')[0]!;
    expect((await watch(send(host, 'POST', IA, json(host, { cookie }), JSON.stringify({ pedido: 'manhã' })))).status).toBe(200);
  });

  const lan = Object.values(networkInterfaces())
    .flat()
    .find((info) => info && info.family === 'IPv4' && !info.internal)?.address;

  it.skipIf(!lan)('get 403 over a real network connection', async () => {
    const { port, dataDir } = await start({ listen: '0.0.0.0' });
    const host = `${lan}:${port}`;
    const forged = { 'x-forwarded-for': '127.0.0.1' };
    const reply = await watch(putKey(host, KEY, forged));
    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body).erro).toMatch(/computador que roda o servidor/);
    expect((await state(host)).local).toBe(false);
    await expect(stat(path.join(dataDir, KEY_FILE))).rejects.toThrow();
  });
});

describe('ANTHROPIC_API_KEY', () => {
  it('wins over the app, which can neither replace nor remove it, nor see any of it', async () => {
    const { host, dataDir } = await start({ envKey: ENV_KEY });
    expect(await state(host)).toEqual({ chave: 'ambiente', ligada: false, disponivel: false, local: true, modelo: 'falso-1' });
    expect((await watch(putKey(host, KEY))).status).toBe(409);
    expect((await watch(send(host, 'DELETE', CHAVE, { origin: `http://${host}` }))).status).toBe(409);
    await expect(stat(path.join(dataDir, KEY_FILE))).rejects.toThrow();
    await watch(turn(host, true));
    await watch(send(host, 'POST', IA, json(host), JSON.stringify({ pedido: 'manhã' })));
    expect(keysUsed).toEqual([ENV_KEY]);
  });
});

describe('a data folder inside the library', () => {
  it('is never used for the key', async () => {
    const inside = path.join(library, 'dados');
    const { host } = await start({ dataDir: inside });
    const reply = await watch(putKey(host, KEY));
    expect(reply.status).toBe(500);
    expect(JSON.parse(reply.body).erro).toMatch(/biblioteca/);
    await expect(stat(path.join(inside, KEY_FILE))).rejects.toThrow();
  });
});
