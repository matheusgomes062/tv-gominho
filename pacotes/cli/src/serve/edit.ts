// Saving channels through `tv-gominho servir --editar` (docs/ferramentas.md#servir). Off unless asked
// for. A device pairs once with the PIN shown in the terminal and gets a session cookie; with it, the
// app may write grades/<nome>.yaml and nao-passar.yaml, and nothing else.

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { BLOCKLIST_FILE, parseBlocklist, parseSchedule, type LibraryWarning } from '@tv-gominho/nucleo';
import { sendJson } from './http';

export const CAPABILITIES_PATH = '/__tv-gominho/capacidades';
export const PAIRING_PATH = '/__tv-gominho/pareamento';
export const WRITE_PATH = '/__tv-gominho/arquivos/';

/** Largest file the server takes. A week of grade is a few KB. */
export const MAX_BODY = 256 * 1024;
/** Wrong PINs in a row before pairing locks. */
export const MAX_ATTEMPTS = 5;
/** First lock; each further lock doubles, up to MAX_LOCK_MS. */
export const LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60_000;
/** How long a pairing request may take to send its PIN. */
const PAIR_TIMEOUT_MS = 10_000;

const COOKIE = 'tvg_sessao';
const PIN_DIGITS = 6;

/**
 * What may be written, relative to the folder being served: the library root is that folder or its
 * "biblioteca/" subfolder (the same two the app looks for). Raw URL text, never decoded: a "%" or a
 * backslash simply does not match.
 */
const ALLOWED = /^(?:(biblioteca)\/)?(?:(grades)\/([A-Za-z0-9][A-Za-z0-9_-]{0,79})\.yaml|(nao-passar)\.yaml)$/i;
const WINDOWS_DEVICES = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

export interface EditOptions {
  pin: string;
  /** Lines for the terminal (lockouts, files written). */
  log(message: string): void;
  now?(): number;
}

export function newPin(): string {
  return String(randomInt(0, 10 ** PIN_DIGITS)).padStart(PIN_DIGITS, '0');
}

/** The routes of editing, or null when the request is not one of them. */
export function createEditor(library: string, options: EditOptions) {
  const now = options.now ?? Date.now;
  const sessions = new Set<string>();
  let failures = 0;
  let locks = 0;
  let lockedUntil = 0;
  let pairing = false;
  // One write at a time: "is it there?" and the rename that follows cannot interleave with another request.
  let queue: Promise<unknown> = Promise.resolve();

  const hasSession = (req: IncomingMessage) => {
    const token = cookie(req, COOKIE);
    return token !== undefined && sessions.has(token);
  };

  /** Answers 429 while pairing is locked. */
  const refuseIfLocked = (req: IncomingMessage, res: ServerResponse) => {
    const wait = lockedUntil - now();
    if (wait <= 0) return false;
    res.setHeader('Retry-After', Math.ceil(wait / 1000));
    fail(req, res, 429, `Muitas tentativas erradas. Tente de novo em ${Math.ceil(wait / 1000)} s.`);
    return true;
  };

  async function pair(req: IncomingMessage, res: ServerResponse) {
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return fail(req, res, 415, 'Envie o PIN como JSON.');
    // One attempt at a time, counted as a failure from the start: parallel requests cannot all slip
    // past the lock while the others are still being read.
    if (pairing) return fail(req, res, 429, 'Outra tentativa de pareamento em andamento. Tente de novo.');
    if (refuseIfLocked(req, res)) return;
    pairing = true;
    failures++;
    let paired = false;
    // A client that never finishes sending its PIN must not hold the attempt forever.
    req.setTimeout(PAIR_TIMEOUT_MS, () => req.destroy());
    try {
      const body = await readBody(req, 1024);
      if (body === null) return fail(req, res, 413, 'Pedido grande demais.');
      let pin = '';
      try {
        const value = JSON.parse(body.toString('utf8')) as { pin?: unknown };
        if (typeof value.pin === 'string') pin = value.pin.trim();
      } catch {
        // not JSON: a wrong PIN like any other
      }
      if (!samePin(pin, options.pin)) return fail(req, res, 403, 'PIN errado.');
      paired = true;
      failures = 0;
      locks = 0;
      const token = randomBytes(32).toString('hex');
      sessions.add(token);
      // No Max-Age: the cookie lasts while the browser is open, the session while this server runs.
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`);
      options.log('Um aparelho foi pareado e pode salvar canais.');
      sendJson(req, res, { pareado: true });
    } finally {
      pairing = false;
      if (!paired && failures >= MAX_ATTEMPTS) {
        const ms = Math.min(LOCK_MS * 2 ** locks, MAX_LOCK_MS);
        locks++;
        failures = 0;
        lockedUntil = now() + ms;
        options.log(`Atenção: ${MAX_ATTEMPTS} PINs errados seguidos. Pareamento travado por ${Math.round(ms / 1000)} s.`);
      }
    }
  }

  async function write(req: IncomingMessage, res: ServerResponse, raw: string, overwrite: boolean) {
    if (!hasSession(req)) return fail(req, res, 401, 'Digite o PIN que aparece no computador.');
    const match = ALLOWED.exec(raw);
    if (!match || (match[3] && WINDOWS_DEVICES.test(match[3]))) return fail(req, res, 400, 'Só dá para gravar grades/<nome>.yaml e nao-passar.yaml.');
    const [, nested, , gradeName] = match;

    const length = Number(req.headers['content-length'] ?? 0);
    if (length > MAX_BODY) return fail(req, res, 413, 'Arquivo grande demais.');
    const body = await readBody(req, MAX_BODY);
    if (body === null) return fail(req, res, 413, 'Arquivo grande demais.');
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(body);
    } catch {
      return fail(req, res, 400, 'O arquivo precisa estar em UTF-8.');
    }
    const problem = gradeName ? gradeProblem(`grades/${gradeName}.yaml`, text) : blocklistProblem(text);
    if (problem) return fail(req, res, 400, problem);

    const job = queue.then(async () => {
      const dir = await targetDir(library, Boolean(nested), Boolean(gradeName));
      if (!dir) return fail(req, res, 400, 'A pasta de destino não fica dentro da biblioteca.');
      const name = gradeName ? `${gradeName}.yaml` : BLOCKLIST_FILE;
      const file = path.join(dir, name);
      const existing = await lstat(file).catch(() => null);
      if (existing && (!overwrite || !existing.isFile())) return fail(req, res, 409, 'Esse arquivo já existe.');
      const temp = path.join(dir, `.tv-gominho-${randomBytes(6).toString('hex')}.tmp`);
      try {
        await writeFile(temp, text, { encoding: 'utf8', flag: 'wx' });
        await rename(temp, file);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      const written = path.relative(library, file).split(path.sep).join('/');
      options.log(`Gravado: ${written}`);
      sendJson(req, res, { caminho: written }, existing ? 200 : 201);
    });
    queue = job.catch(() => {});
    await job;
  }

  return {
    /** Handles the request when it is one of the editing routes; false otherwise. */
    async handle(req: IncomingMessage, res: ServerResponse, url: string, query: string): Promise<boolean> {
      if (url === CAPABILITIES_PATH && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(req, res, { editar: true, pareado: hasSession(req) });
        return true;
      }
      const isPair = url === PAIRING_PATH && req.method === 'POST';
      const isWrite = url.startsWith(WRITE_PATH) && req.method === 'PUT';
      if (!isPair && !isWrite) return false;
      // CSRF: a page elsewhere may send a request here, with the cookie even; it cannot fake Origin.
      if (!sameOrigin(req)) {
        fail(req, res, 403, 'Origem não permitida.');
        return true;
      }
      if (isPair) await pair(req, res);
      else await write(req, res, url.slice(WRITE_PATH.length), new URLSearchParams(query).get('substituir') === '1');
      return true;
    },
  };
}

/** Same origin as the address the page was opened at (already checked against allowedHost). */
function sameOrigin(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (!origin || !req.headers.host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && parsed.host === new URL(`http://${req.headers.host}`).host;
  } catch {
    return false;
  }
}

function samePin(given: string, pin: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(pin);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return undefined;
}

/** The body, or null past `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (chunk: Buffer) => {
      if (over) return;
      size += chunk.length;
      if (size > limit) {
        // Answered right away; the rest is dropped with the connection.
        over = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)));
    // Cut off before the end (timeout, client gone): no body. After 'end' this changes nothing.
    req.on('close', () => resolve(null));
    req.on('error', reject);
  });
}

function fail(req: IncomingMessage, res: ServerResponse, status: number, message: string) {
  // Once the answer is out, Node drops whatever of the body is left.
  res.setHeader('Connection', 'close');
  sendJson(req, res, { erro: message }, status);
}

/** Why a grade would not load (parseSchedule gave up on it), or null. */
export function gradeProblem(file: string, text: string): string | null {
  const warnings: LibraryWarning[] = [];
  if (parseSchedule(file, text, warnings)) return null;
  return `A grade não é válida: ${warnings.map((warning) => warning.message).join(' ') || 'formato desconhecido.'}`;
}

/**
 * Why nao-passar.yaml would not be read as written, or null. The app reads a bad list leniently (it drops
 * what it does not understand); a file written through the server must have nothing to drop.
 */
export function blocklistProblem(text: string): string | null {
  const warnings: LibraryWarning[] = [];
  parseBlocklist(BLOCKLIST_FILE, text, warnings);
  return warnings.length === 0 ? null : `A lista não é válida: ${warnings.map((warning) => warning.message).join(' ')}`;
}

/**
 * The folder the file goes into: the library root (the served folder or its "biblioteca/" subfolder)
 * or grades/ under it, matched case-insensitively and created when missing. Null when any of it is
 * not a real folder inside the library once links are followed.
 */
async function targetDir(library: string, nested: boolean, grades: boolean): Promise<string | null> {
  const realLibrary = await realpath(library);
  let dir = library;
  if (nested) {
    const found = await childDir(dir, 'biblioteca');
    if (!found) return null;
    dir = found;
  }
  if (grades) {
    const found = await childDir(dir, 'grades');
    if (found) dir = found;
    else {
      if (!(await inside(realLibrary, dir))) return null;
      dir = path.join(dir, 'grades');
      await mkdir(dir);
    }
  }
  return (await inside(realLibrary, dir)) ? dir : null;
}

async function childDir(parent: string, name: string): Promise<string | null> {
  const entries = await readdir(parent, { withFileTypes: true }).catch(() => []);
  const entry = entries.find((item) => item.name.toLowerCase() === name && (item.isDirectory() || item.isSymbolicLink()));
  return entry ? path.join(parent, entry.name) : null;
}

async function inside(realLibrary: string, dir: string): Promise<boolean> {
  const real = await realpath(dir).catch(() => null);
  if (!real || !(await stat(real)).isDirectory()) return false;
  const relative = path.relative(realLibrary, real);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
