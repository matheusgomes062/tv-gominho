import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_MS, MAX_ATTEMPTS, MAX_BODY } from '../serve/edit';
import { createLibraryServer } from './servir';

const PIN = '123456';
const GRADE = 'nome: Manhã\nblocos:\n  - horario: "08:00"\n    itens:\n      - programa: dbz\n';

let root: string;
let library: string;
let app: string;
let clock = 0;
const logs: string[] = [];
const servers: Server[] = [];

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function start(edit: boolean): Promise<string> {
  const server = createLibraryServer(library, app, edit ? { pin: PIN, log: (line) => logs.push(line), now: () => clock } : undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A raw request; `path` goes out exactly as written (no URL normalization). */
function send(host: string, method: string, urlPath: string, headers: Record<string, string> = {}, body?: string | Buffer): Promise<Reply> {
  const [hostname, port] = host.split(':');
  return new Promise((resolve, reject) => {
    const req = request({ host: hostname, port: Number(port), method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    // A server that answers before reading a big body may close the socket under us; the answer still counts.
    req.on('error', reject);
    req.end(body);
  });
}

let editing: string;
let readOnly: string;
const origin = () => `http://${editing}`;

const pair = (pin: string, headers: Record<string, string> = {}) =>
  send(editing, 'POST', '/__tv-gominho/pareamento', { 'content-type': 'application/json', origin: origin(), ...headers }, JSON.stringify({ pin }));

async function session(): Promise<string> {
  const res = await pair(PIN);
  expect(res.status).toBe(200);
  const cookie = String(res.headers['set-cookie']).split(';')[0]!;
  return cookie;
}

const put = (cookie: string, file: string, body: string | Buffer = GRADE, headers: Record<string, string> = {}) =>
  send(editing, 'PUT', `/__tv-gominho/arquivos/${file}`, { origin: origin(), cookie, 'content-type': 'text/yaml', ...headers }, body);

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tv-gominho-editar-'));
  library = path.join(root, 'biblioteca');
  app = path.join(root, 'app');
  await mkdir(path.join(library, 'programas/dbz/episodios'), { recursive: true });
  await mkdir(path.join(library, 'grades'), { recursive: true });
  await mkdir(path.join(root, 'fora'), { recursive: true });
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, 'index.html'), '<!doctype html><title>TV</title>');
  await writeFile(path.join(library, 'grades/existente.yaml'), 'nome: Antigo\n');
  editing = await start(true);
  readOnly = await start(false);
});

beforeEach(() => {
  // Each test starts after any lock the previous one left.
  clock += 10 * 60 * 60_000;
});

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(root, { recursive: true, force: true });
});

describe('servir without --editar', () => {
  it('has no write route and says editing is off', async () => {
    expect((await send(readOnly, 'PUT', '/__tv-gominho/arquivos/grades/nova.yaml', { origin: `http://${readOnly}` }, GRADE)).status).toBe(405);
    expect((await send(readOnly, 'POST', '/__tv-gominho/pareamento', { origin: `http://${readOnly}`, 'content-type': 'application/json' }, '{"pin":"1"}')).status).toBe(405);
    const caps = await send(readOnly, 'GET', '/__tv-gominho/capacidades');
    expect(JSON.parse(caps.body)).toEqual({ editar: false, ia: false, pareado: false });
    await expect(readdir(path.join(library, 'grades'))).resolves.not.toContain('nova.yaml');
  });
});

describe('servir --editar', () => {
  it('reports editing on, and the pairing of this device', async () => {
    expect(JSON.parse((await send(editing, 'GET', '/__tv-gominho/capacidades')).body)).toEqual({ editar: true, ia: false, pareado: false });
    const cookie = await session();
    expect(JSON.parse((await send(editing, 'GET', '/__tv-gominho/capacidades', { cookie })).body)).toEqual({ editar: true, ia: false, pareado: true });
  });

  it('pairs with the right PIN only, with an HttpOnly SameSite=Strict cookie', async () => {
    expect((await pair('000000')).status).toBe(403);
    expect((await pair('')).status).toBe(403);
    expect((await send(editing, 'POST', '/__tv-gominho/pareamento', { origin: origin() }, `pin=${PIN}`)).status).toBe(415);
    const res = await pair(PIN);
    expect(res.status).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/^tvg_sessao=[0-9a-f]{64}; Path=\/; HttpOnly; SameSite=Strict$/);
  });

  it('locks pairing after repeated wrong PINs, the right one included, and logs it', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect((await pair('999999')).status).toBe(403);
    const locked = await pair(PIN);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBe(LOCK_MS / 1000);
    expect(logs.some((line) => line.includes('travado'))).toBe(true);
    clock += LOCK_MS;
    // The next lock lasts twice as long.
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect((await pair('999999')).status).toBe(403);
    clock += LOCK_MS;
    expect((await pair(PIN)).status).toBe(429);
    clock += LOCK_MS;
    expect((await pair(PIN)).status).toBe(200);
  });

  it('compares at most MAX_ATTEMPTS PINs from a burst of parallel requests', async () => {
    const replies = await Promise.all(Array.from({ length: 40 }, (_, i) => pair(String(100000 + i))));
    const compared = replies.filter((reply) => reply.status === 403).length;
    expect(compared).toBeGreaterThan(0);
    expect(compared).toBeLessThanOrEqual(MAX_ATTEMPTS);
    expect(replies.every((reply) => reply.status === 403 || reply.status === 429)).toBe(true);
  });

  it('refuses the right PIN sent among wrong ones while locked', async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) expect((await pair('999999')).status).toBe(403);
    const replies = await Promise.all([...Array.from({ length: 10 }, () => pair('999999')), pair(PIN), pair(PIN)]);
    expect(replies.map((reply) => reply.status)).toEqual(Array(12).fill(429));
    expect(replies.some((reply) => reply.headers['set-cookie'])).toBe(false);
  });

  it('frees the attempt when a request ends without a PIN', async () => {
    await new Promise<void>((resolve) => {
      const [hostname, port] = editing.split(':');
      const req = request({ host: hostname, port: Number(port), method: 'POST', path: '/__tv-gominho/pareamento', headers: { 'content-type': 'application/json', origin: origin(), 'content-length': '100' } });
      req.on('error', () => resolve());
      req.write('{"pin":');
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await pair(PIN)).status).toBe(200);
  });

  it('refuses writes without a session', async () => {
    expect((await put('', 'grades/sem-sessao.yaml')).status).toBe(401);
    expect((await put('tvg_sessao=inventada', 'grades/sem-sessao.yaml')).status).toBe(401);
    await expect(readdir(path.join(library, 'grades'))).resolves.not.toContain('sem-sessao.yaml');
  });

  it('refuses requests from another origin, or with none (CSRF)', async () => {
    const cookie = await session();
    expect((await put(cookie, 'grades/csrf.yaml', GRADE, { origin: 'http://malicioso.example.com' })).status).toBe(403);
    expect((await put(cookie, 'grades/csrf.yaml', GRADE, { origin: `https://${editing}` })).status).toBe(403);
    expect((await put(cookie, 'grades/csrf.yaml', GRADE, { origin: 'null' })).status).toBe(403);
    expect((await put(cookie, 'grades/csrf.yaml', GRADE, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await send(editing, 'PUT', '/__tv-gominho/arquivos/grades/csrf.yaml', { cookie }, GRADE)).status).toBe(403);
    expect((await pair(PIN, { origin: 'http://malicioso.example.com' })).status).toBe(403);
    await expect(readdir(path.join(library, 'grades'))).resolves.not.toContain('csrf.yaml');
  });

  it('keeps refusing other host names (DNS rebinding)', async () => {
    const cookie = await session();
    const res = await put(cookie, 'grades/rebind.yaml', GRADE, { host: 'malicioso.example.com', origin: 'http://malicioso.example.com' });
    expect(res.status).toBe(421);
    expect((await send(editing, 'GET', '/__tv-gominho/capacidades', { host: 'malicioso.example.com' })).status).toBe(421);
  });

  it.each([
    '../fora/x.yaml',
    'grades/../../fora/x.yaml',
    'grades/..%2F..%2Ffora%2Fx.yaml',
    '%2e%2e/fora/x.yaml',
    'grades%2Fx.yaml',
    'grades\\x.yaml',
    'grades/..\\..\\fora\\x.yaml',
    '/etc/x.yaml',
    'C:/x.yaml',
    'C:%5Cx.yaml',
    'grades/sub/x.yaml',
    'grades/.escondido.yaml',
    'grades/x.yml',
    'grades/x.yaml.exe',
    'grades/x.YAML%00.txt',
    'grades/nul.yaml',
    'grades/COM1.yaml',
    'grades/.yaml',
    'grades/x%20y.yaml',
    'programas/dbz/programa.yaml',
    'configuracao.yaml',
    'outra/nao-passar.yaml',
    'biblioteca/biblioteca/grades/x.yaml',
    'nao-passar.yaml/x',
  ])('refuses the path %s', async (file) => {
    const cookie = await session();
    const res = await put(cookie, file);
    expect([400, 404, 405]).toContain(res.status);
    await expect(readdir(path.join(root, 'fora'))).resolves.toEqual([]);
    await expect(readdir(path.join(library, 'grades'))).resolves.not.toContain('x.yaml');
  });

  it('refuses a grades folder that links outside the library', async () => {
    try {
      await symlink(path.join(root, 'fora'), path.join(library, 'biblioteca'), 'junction');
    } catch {
      return; // no permission to create links here (Windows without developer mode): nothing to test
    }
    try {
      const cookie = await session();
      expect((await put(cookie, 'biblioteca/grades/x.yaml')).status).toBe(400);
      await expect(readdir(path.join(root, 'fora'))).resolves.toEqual([]);
    } finally {
      await rm(path.join(library, 'biblioteca'), { recursive: true, force: true });
    }
  });

  it('refuses bodies over the size limit', async () => {
    const cookie = await session();
    const big = GRADE + `# ${'x'.repeat(MAX_BODY)}\n`;
    expect((await put(cookie, 'grades/grande.yaml', big)).status).toBe(413);
    await expect(readdir(path.join(library, 'grades'))).resolves.not.toContain('grande.yaml');
  });

  it('refuses a grade that does not load, and text that is not UTF-8', async () => {
    const cookie = await session();
    const bad = await put(cookie, 'grades/ruim.yaml', 'blocos: [');
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body).erro).toContain('grade não é válida');
    expect((await put(cookie, 'grades/ruim.yaml', '- uma\n- lista\n')).status).toBe(400);
    expect((await put(cookie, 'grades/ruim.yaml', Buffer.from([0x6e, 0x6f, 0x6d, 0x65, 0x3a, 0x20, 0xff, 0xfe]))).status).toBe(400);
    await expect(readdir(path.join(library, 'grades'))).resolves.not.toContain('ruim.yaml');
  });

  it('writes a new grade with exactly the content sent, leaving no temporary file', async () => {
    const cookie = await session();
    const res = await put(cookie, 'grades/manha.yaml');
    expect(res.status).toBe(201);
    expect(JSON.parse(res.body)).toEqual({ caminho: 'grades/manha.yaml' });
    expect(await readFile(path.join(library, 'grades/manha.yaml'), 'utf8')).toBe(GRADE);
    expect((await readdir(path.join(library, 'grades'))).filter((name) => name.startsWith('.'))).toEqual([]);
    expect(logs).toContain('Gravado: grades/manha.yaml');
  });

  it('never overwrites unless asked with ?substituir=1', async () => {
    const cookie = await session();
    expect((await put(cookie, 'grades/existente.yaml')).status).toBe(409);
    expect((await put(cookie, 'GRADES/EXISTENTE.yaml')).status).toBe(409);
    expect(await readFile(path.join(library, 'grades/existente.yaml'), 'utf8')).toBe('nome: Antigo\n');
    expect((await put(cookie, 'grades/existente.yaml?substituir=1')).status).toBe(200);
    expect(await readFile(path.join(library, 'grades/existente.yaml'), 'utf8')).toBe(GRADE);
  });

  it('writes nao-passar.yaml at the library root, if the app reads it without warnings', async () => {
    const cookie = await session();
    expect((await put(cookie, 'nao-passar.yaml', '- dbz\n')).status).toBe(400);
    expect((await put(cookie, 'nao-passar.yaml', 'programas: [')).status).toBe(400);
    expect((await put(cookie, 'nao-passar.yaml', 'outra: coisa\n')).status).toBe(400);
    const list = 'programas:\n  - dbz\n';
    expect((await put(cookie, 'nao-passar.yaml', list)).status).toBe(201);
    expect(await readFile(path.join(library, 'nao-passar.yaml'), 'utf8')).toBe(list);
    expect((await put(cookie, 'nao-passar.yaml', 'programas: []\n')).status).toBe(409);
    expect((await put(cookie, 'nao-passar.yaml?substituir=1', 'programas: []\n')).status).toBe(200);
  });

  it('writes under a nested biblioteca/ folder, creating grades/ there', async () => {
    const nested = path.join(library, 'Biblioteca');
    await mkdir(nested);
    try {
      const cookie = await session();
      expect((await put(cookie, 'biblioteca/grades/aninhada.yaml')).status).toBe(201);
      expect(await readFile(path.join(nested, 'grades/aninhada.yaml'), 'utf8')).toBe(GRADE);
    } finally {
      await rm(nested, { recursive: true, force: true });
    }
  });
});
