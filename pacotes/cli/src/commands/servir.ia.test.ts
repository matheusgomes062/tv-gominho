import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IaError, type IaProvider, type ProposalRequest } from '../ia/provider';
import { createAssistant, IA_INTERVAL_MS, IA_PER_HOUR, MAX_IA_BODY } from '../serve/ia';
import { createLibraryServer } from './servir';

const PIN = '654321';
const IA = '/__tv-gominho/ia/proposta';

const PROPOSAL = {
  nome: 'Manhã calma',
  faixas: [{ inicio: '08:00', fim: '11:00' }],
  dias: ['seg', 'qua'],
  programas: ['pinguins'],
  comerciais: { proprios: false, a_cada_minutos: 0, por_intervalo: 1, depois_do_episodio: false, vinhetas_no_intervalo: false },
  marca: '',
  epoca: null,
  explicacao: 'Três horas de Pinguins.',
};

let root: string;
let library: string;
let app: string;
let clock = 0;
const logs: string[] = [];
const servers: Server[] = [];
const asked: ProposalRequest[] = [];
let answer: () => Promise<string> = async () => JSON.stringify(PROPOSAL);

const provider: IaProvider = {
  name: 'Falso',
  model: 'falso-1',
  async propose(req) {
    asked.push(req);
    return answer();
  },
};

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(host: string, method: string, urlPath: string, headers: Record<string, string> = {}, body?: string): Promise<Reply> {
  const [hostname, port] = host.split(':');
  return new Promise((resolve, reject) => {
    const req = request({ host: hostname, port: Number(port), method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function start(options: { ia: boolean; editar: boolean } | null): Promise<string> {
  const now = () => clock;
  const log = (line: string) => logs.push(line);
  const server = createLibraryServer(
    library,
    app,
    options ? { pin: PIN, log, now, write: options.editar, assistant: options.ia ? createAssistant(library, { provider, log, now }) : undefined } : undefined,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

let iaOnly: string;
let editOnly: string;
let readOnly: string;

const json = (host: string, extra: Record<string, string> = {}) => ({ 'content-type': 'application/json', origin: `http://${host}`, ...extra });

async function session(host: string): Promise<string> {
  const res = await send(host, 'POST', '/__tv-gominho/pareamento', json(host), JSON.stringify({ pin: PIN }));
  expect(res.status).toBe(200);
  return String(res.headers['set-cookie']).split(';')[0]!;
}

const ask = (host: string, cookie: string, body: unknown = { pedido: 'uma manhã de 3 horas com desenhos calmos' }, extra: Record<string, string> = {}) =>
  send(host, 'POST', IA, json(host, { cookie, ...extra }), typeof body === 'string' ? body : JSON.stringify(body));

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'tv-gominho-ia-'));
  library = path.join(root, 'biblioteca');
  app = path.join(root, 'app');
  for (const show of ['dbz', 'pinguins']) {
    await mkdir(path.join(library, 'programas', show, 'episodios'), { recursive: true });
    await writeFile(path.join(library, 'programas', show, 'episodios', '001.mp4'), '');
  }
  await mkdir(app, { recursive: true });
  await writeFile(path.join(app, 'index.html'), '<!doctype html><title>TV</title>');
  iaOnly = await start({ ia: true, editar: false });
  editOnly = await start({ ia: false, editar: true });
  readOnly = await start(null);
});

beforeEach(() => {
  // Past the interval and the hour's budget of the previous test.
  clock += 2 * 3600_000;
  asked.length = 0;
  logs.length = 0;
  answer = async () => JSON.stringify(PROPOSAL);
});

afterAll(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(root, { recursive: true, force: true });
});

describe('servir without --ia', () => {
  it('has no assistant route and says the assistant is off', async () => {
    for (const host of [readOnly, editOnly]) {
      const caps = JSON.parse((await send(host, 'GET', '/__tv-gominho/capacidades')).body);
      expect(caps.ia).toBe(false);
      expect((await send(host, 'POST', IA, json(host), '{"pedido":"x"}')).status).toBe(405);
    }
    expect(asked).toHaveLength(0);
  });
});

describe('servir --ia', () => {
  it('reports the assistant on and saving off when --editar is not given', async () => {
    expect(JSON.parse((await send(iaOnly, 'GET', '/__tv-gominho/capacidades')).body)).toEqual({ editar: false, ia: true, pareado: false });
    const cookie = await session(iaOnly);
    expect(logs).toContain('Um aparelho foi pareado e pode usar a IA.');
    // Pairing for the assistant does not open the write route.
    const put = await send(iaOnly, 'PUT', '/__tv-gominho/arquivos/grades/nova.yaml', { origin: `http://${iaOnly}`, cookie }, 'nome: x\n');
    expect(put.status).toBe(405);
  });

  it('needs a paired device', async () => {
    expect((await ask(iaOnly, '')).status).toBe(401);
    expect((await ask(iaOnly, 'tvg_sessao=inventada')).status).toBe(401);
    expect(asked).toHaveLength(0);
  });

  it('refuses requests from other origins, even with the cookie', async () => {
    const cookie = await session(iaOnly);
    expect((await ask(iaOnly, cookie, undefined, { origin: 'http://malicioso.example.com' })).status).toBe(403);
    expect((await ask(iaOnly, cookie, undefined, { origin: `http://${iaOnly}`, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const noOrigin = await send(iaOnly, 'POST', IA, { 'content-type': 'application/json', cookie }, '{"pedido":"x"}');
    expect(noOrigin.status).toBe(403);
    expect((await send(iaOnly, 'POST', IA, json(iaOnly, { cookie, host: 'malicioso.example.com' }), '{"pedido":"x"}')).status).toBe(421);
    expect(asked).toHaveLength(0);
  });

  it('answers with a checked proposal, built from metadata only, and logs no content', async () => {
    const cookie = await session(iaOnly);
    const res = await ask(iaOnly, cookie, { pedido: 'uma manhã de 3 horas com desenhos calmos', duracoes: { pinguins: 11.4, naruto: 20, dbz: -3 } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).proposta).toEqual({
      name: 'Manhã calma',
      ranges: [{ start: 8 * 3600, end: 11 * 3600 }],
      days: ['seg', 'qua'],
      shows: ['pinguins'],
      adBreaks: null,
      brand: '',
      era: null,
      note: 'Três horas de Pinguins.',
    });
    expect(asked).toHaveLength(1);
    const { prompt, schema } = asked[0]!;
    expect(prompt).toContain('uma manhã de 3 horas com desenhos calmos');
    expect(prompt).toContain('"duracao_tipica_min": 11');
    expect(prompt).not.toContain('naruto');
    expect(prompt).not.toContain('.mp4');
    expect(prompt).not.toContain(root.replace(/\\/g, '\\\\'));
    expect(JSON.stringify(schema)).toContain('pinguins');
    expect(logs.filter((line) => line.startsWith('IA:'))).toEqual(['IA: proposta pedida.', 'IA: proposta ok.']);
    expect(logs.join('\n')).not.toContain('calmos');
  });

  it('turns a proposal with a show that does not exist into a clear error', async () => {
    const cookie = await session(iaOnly);
    answer = async () => JSON.stringify({ ...PROPOSAL, programas: ['naruto'] });
    const res = await ask(iaOnly, cookie);
    expect(res.status).toBe(422);
    expect(JSON.parse(res.body).erro).toMatch(/não está na biblioteca/);
    expect(logs).toContain('IA: proposta com erro.');
  });

  it('passes on the messages of the provider, and nothing else from a failure', async () => {
    const cookie = await session(iaOnly);
    answer = async () => {
      throw new IaError('A Anthropic recusou a chave em ANTHROPIC_API_KEY. Confira a chave no computador.');
    };
    const refused = await ask(iaOnly, cookie);
    expect(refused.status).toBe(502);
    expect(JSON.parse(refused.body).erro).toContain('recusou a chave');
    clock += IA_INTERVAL_MS;
    answer = async () => {
      throw new Error('socket hang up sk-ant-segredo');
    };
    const broken = await ask(iaOnly, cookie);
    expect(broken.body).not.toContain('sk-ant');
  });

  it('refuses empty, long or oversized requests without calling the provider', async () => {
    const cookie = await session(iaOnly);
    expect((await ask(iaOnly, cookie, { pedido: '   ' })).status).toBe(400);
    expect((await ask(iaOnly, cookie, { pedido: 'a'.repeat(501) })).status).toBe(400);
    expect((await ask(iaOnly, cookie, 'não é json')).status).toBe(400);
    expect((await ask(iaOnly, cookie, { pedido: 'x', atual: 'a'.repeat(MAX_IA_BODY) })).status).toBe(413);
    expect((await send(iaOnly, 'POST', IA, { origin: `http://${iaOnly}`, cookie, 'content-type': 'text/plain' }, 'oi')).status).toBe(415);
    expect(asked).toHaveLength(0);
  });

  it('limits how often the key is used', async () => {
    const cookie = await session(iaOnly);
    expect((await ask(iaOnly, cookie)).status).toBe(200);
    const soon = await ask(iaOnly, cookie);
    expect(soon.status).toBe(429);
    expect(Number(soon.headers['retry-after'])).toBe(IA_INTERVAL_MS / 1000);
    for (let i = 1; i < IA_PER_HOUR; i++) {
      clock += IA_INTERVAL_MS;
      expect((await ask(iaOnly, cookie)).status).toBe(200);
    }
    clock += IA_INTERVAL_MS;
    expect((await ask(iaOnly, cookie)).status).toBe(429);
    expect(asked).toHaveLength(IA_PER_HOUR);
    clock += 3600_000;
    expect((await ask(iaOnly, cookie)).status).toBe(200);
  });

  it('takes one request at a time', async () => {
    const cookie = await session(iaOnly);
    let release!: () => void;
    answer = () => new Promise((resolve) => (release = () => resolve(JSON.stringify(PROPOSAL))));
    const first = ask(iaOnly, cookie);
    while (asked.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    clock += IA_INTERVAL_MS;
    expect((await ask(iaOnly, cookie)).status).toBe(429);
    release();
    expect((await first).status).toBe(200);
  });
});
